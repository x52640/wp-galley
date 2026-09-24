import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, relative } from 'node:path';
import type {
  PublishTargetSummary,
  SetupCheck,
  SetupConnectionResult,
  SetupDestinationKey,
  SetupDestinationOption,
  SetupProblem,
} from '../contract/api.js';
import { createSecretScrubber } from '../config/secrets.js';
import { writeFileAtomic } from '../config/env-file.js';
import { isLoopbackHostname } from '../config/env.js';
import { readBodyCapped, ResponseTooLargeError, WordPressClient } from './client.js';
import { WordPressError, wordpressErrorCodes } from './errors.js';
import { fetchIdentity, fetchPostTypes, fetchTaxonomies, type SiteIdentity } from './site.js';
import type { PostType, Taxonomy } from './schemas.js';
import { PublishTargetError, PublishTargetsFileSchema } from './targets.js';

/**
 * 首次設定精靈的 WordPress 端（P8-T002，D-016）。
 *
 * 1. `diagnoseConnection`：測試連線。**只讀**（`/wp-json/`、`/users/me`、`/types`、`/taxonomies`），
 *    不重試，每一種失敗都翻成「發生什麼事／為什麼／下一步」（D-008：不讓使用者猜）。
 * 2. 目的地：看站上實際有什麼，組出 `article-v1` 的文章／頁面 target，格式照
 *    `config/publish-targets.example.json`；分類法的 REST 名稱照 `/wp/v2/taxonomies` 的 rest_base。
 * 3. 寫站台設定檔：既有的 target 原樣保留，同 key 要明確取代；覆寫前先備份。
 *
 * 規則的家：docs/specs/security.md「設定精靈寫入的秘密」、wordpress-site.md「設定精靈」。
 */

// --- 輸入整理 ----------------------------------------------------------------

/**
 * 使用者貼的網址 → 站台根網址。沒寫 scheme 補 https；結尾的 `/wp-admin…`、`/wp-login.php`、
 * `/wp-json…` 去掉（常有人直接從後台網址列複製）。看不懂回 null。
 */
export function normalizeSiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  const path = parsed.pathname
    .replace(/\/(wp-admin|wp-json)(\/.*)?$/, '')
    .replace(/\/wp-login\.php$/, '')
    .replace(/\/+$/, '');
  return parsed.origin + path;
}

/**
 * 本機架的測試站可以用 http；其他一律 https。判斷的家在 config（啟動設定也要用，P5-T023）；
 * 這裡轉出，既有的 import 不用改。
 */
export { isLoopbackHostname };

/** WordPress 產生的應用程式密碼：24 個英數字，顯示時每 4 個一組。空白一律拿掉。 */
export function normalizeAppPassword(raw: string): string {
  return raw.replace(/\s+/g, '');
}

const APP_PASSWORD_PATTERN = /^[A-Za-z0-9]{24}$/;

// --- 權限 --------------------------------------------------------------------

export interface SitePermissions {
  readonly canPublishPosts: boolean;
  readonly canPublishPages: boolean;
  readonly canUpload: boolean;
  readonly roles: readonly string[];
}

const ROLE_POSTS = new Set(['author', 'editor', 'administrator', 'super_admin']);
const ROLE_PAGES = new Set(['editor', 'administrator', 'super_admin']);

/**
 * 能不能發。優先看 `capabilities`（context=edit 才有，最準）；沒有就退回角色推斷，
 * 因為有些外掛會把 capabilities 從回應裡拿掉。
 */
export function permissionsOf(identity: SiteIdentity): SitePermissions {
  const caps = identity.user.capabilities;
  const roles = identity.roles;
  const has = (cap: string, fallback: Set<string>): boolean =>
    caps !== undefined ? caps[cap] === true : roles.some((role) => fallback.has(role));
  return {
    canPublishPosts: has('publish_posts', ROLE_POSTS),
    canPublishPages: has('publish_pages', ROLE_PAGES),
    canUpload: has('upload_files', ROLE_POSTS),
    roles,
  };
}

// --- 測試連線 ----------------------------------------------------------------

export interface ConnectionInput {
  readonly url: string;
  readonly username: string;
  readonly appPassword: string;
}

export interface DiagnoseOptions {
  /** 測試換成假的；正式用 Node 內建 fetch。 */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** 測試通過時交給呼叫端存起來的東西。**不會**出現在 API 回應裡。 */
export interface VerifiedCredentials {
  readonly url: string;
  readonly username: string;
  /** 已去掉空白。 */
  readonly appPassword: string;
}

export interface DiagnoseOutcome {
  /** testId 與 siteChange 由路由補（它們跟伺服器狀態有關，跟這個站本身無關）。 */
  readonly result: Omit<SetupConnectionResult, 'testId' | 'siteChange'>;
  readonly credentials: VerifiedCredentials | null;
}

const CHECK_LABELS: Record<SetupCheck['key'], string> = {
  https: '網址是 https',
  reachable: '連得上網站',
  rest: 'REST API 開著',
  auth: '帳號與應用程式密碼正確',
  permission: '帳號可以發布',
  types: '文章／頁面有開放 REST',
};
const CHECK_ORDER: SetupCheck['key'][] = ['https', 'reachable', 'rest', 'auth', 'permission', 'types'];

const DEFAULT_TIMEOUT_MS = 15_000;
/** `/wp-json/` 首頁的上限。外掛多的站可能到 1–3 MB；再大就不像 WordPress，也不值得把記憶體吃光。 */
const MAX_INDEX_BYTES = 8 * 1024 * 1024;

/** 通過的關卡、失敗的那一關、後面沒跑的，照順序列成清單。 */
function checklist(
  states: Partial<Record<SetupCheck['key'], SetupCheck['state']>>,
  labels: Partial<Record<SetupCheck['key'], string>> = {},
): SetupCheck[] {
  return CHECK_ORDER.map((key) => ({
    key,
    label: labels[key] ?? CHECK_LABELS[key],
    state: states[key] ?? 'skipped',
  }));
}

function problem(kind: SetupProblem['kind'], title: string, detail: string, next: string): SetupProblem {
  return { kind, title, detail, next };
}

const PERMALINK_HINT =
  '確認填的是 WordPress 站的首頁網址（WordPress 裝在子目錄的話要包含子目錄）。是的話，到後台「設定 → 永久連結」選「文章名稱」並儲存，再測一次。';

const PLUGIN_HINT =
  '到那個外掛的設定裡允許 REST API（至少對登入的使用者），或把 /wp/v2/users 從封鎖清單拿掉，再測一次。';

function describeNetworkError(error: unknown, host: string, timeoutMs: number): SetupProblem {
  const cause = (error as { cause?: { code?: string; message?: string } } | null)?.cause;
  const code = cause?.code ?? (error as { code?: string } | null)?.code ?? '';
  const name = (error as { name?: string } | null)?.name ?? '';

  if (name === 'AbortError' || name === 'TimeoutError') {
    return problem(
      'unreachable',
      '網站太久沒有回應',
      `等了 ${Math.round(timeoutMs / 1000)} 秒，「${host}」都沒有回應。`,
      '在瀏覽器打開這個網址看看是不是很慢，過幾分鐘再測一次。',
    );
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return problem(
      'unreachable',
      '找不到這個網站',
      `查不到「${host}」的位址（DNS 找不到）。可能是網址打錯，或網域剛設定還沒生效。`,
      '在瀏覽器打開這個網址確認拼字；網域剛買或剛改 DNS 的話，等幾個小時再試。',
    );
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return problem(
      'unreachable',
      '連不上這個網站',
      `「${host}」拒絕連線或中斷了連線（${code}）。網站可能沒在執行，或網址的埠號不對。`,
      '在瀏覽器打開這個網址看看；打不開就是網站本身的問題，先聯絡主機商。',
    );
  }
  if (/CERT|TLS|SSL/.test(code)) {
    return problem(
      'unreachable',
      '網站的 SSL 憑證有問題',
      `「${host}」的 https 憑證驗證失敗（${code}：過期、自簽或網域不符）。帶著密碼去連一個驗不過身分的網站不安全，所以發布台不連。`,
      '到主機商後台重新簽發憑證（例如 Let’s Encrypt），在瀏覽器打開確認沒有安全性警告後再測一次。',
    );
  }
  return problem(
    'unreachable',
    '連不上這個網站',
    `連線失敗${code ? `（${code}）` : ''}。`,
    '在瀏覽器打開這個網址確認打得開，再測一次。',
  );
}

interface IndexProbe {
  /** null＝匿名讀不到（被擋，但登入後可能可以）。 */
  readonly appPasswordsAdvertised: boolean | null;
  readonly anonymousBlocked: boolean;
}

type IndexOutcome = { ok: true; probe: IndexProbe } | { ok: false; problem: SetupProblem; stage: 'reachable' | 'rest' };

/** 匿名讀 `/wp-json/`：網站在不在、是不是 WordPress、REST 有沒有被擋、應用程式密碼有沒有開。 */
async function probeIndex(siteUrl: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<IndexOutcome> {
  const host = new URL(siteUrl).host;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let text = '';
  try {
    response = await fetchImpl(`${siteUrl}/wp-json/`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    });
    // 逾時一直有效到本體讀完；本體有上限。
    if (response.status < 300 || response.status >= 400) text = await readBodyCapped(response, MAX_INDEX_BYTES);
  } catch (error) {
    if (error instanceof ResponseTooLargeError) {
      return {
        ok: false,
        stage: 'rest',
        problem: problem(
          'not-wordpress',
          '這個網址回的東西太大，不像 WordPress',
          `${siteUrl}/wp-json/ 的${error.message}。WordPress 的 REST 首頁不會這麼大。`,
          PERMALINK_HINT,
        ),
      };
    }
    return { ok: false, stage: 'reachable', problem: describeNetworkError(error, host, timeoutMs) };
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    let target: string | null = null;
    try {
      target = location ? normalizeSiteUrl(new URL(location, `${siteUrl}/wp-json/`).toString()) : null;
    } catch {
      target = null; // Location 寫壞了：當成「會轉址、但不知道轉去哪」
    }
    return {
      ok: false,
      stage: 'reachable',
      problem: problem(
        'redirect',
        '網址會被轉到別的地方',
        `「${siteUrl}」會被轉到${target ? `「${target}」` : '別的網址'}。轉址時帳號密碼可能被丟掉，會出現「密碼明明對卻說沒權限」。`,
        target ? `把網址改成「${target}」再測一次。` : '在瀏覽器打開這個網址，把最後停下來的網址填進來再測一次。',
      ),
    };
  }

  let json: unknown = null;
  try {
    json = text.trim().length > 0 ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const isObject = json !== null && typeof json === 'object' && !Array.isArray(json);

  if (response.status === 401 || response.status === 403) {
    if (isObject) {
      // 安全外掛常把「沒登入的 REST」關掉；帶帳號密碼可能就通，先往下測。
      return { ok: true, probe: { appPasswordsAdvertised: null, anonymousBlocked: true } };
    }
    return {
      ok: false,
      stage: 'rest',
      problem: problem(
        'rest-blocked',
        'REST API 被擋住了',
        `對 ${siteUrl}/wp-json/ 的請求被擋下（HTTP ${response.status}），回的是一個網頁而不是資料——通常是主機商的防火牆（WAF）或 Cloudflare 之類的防護。`,
        '請主機商（或在 Cloudflare 的防火牆規則裡）放行 /wp-json/ 開頭的網址，再測一次。',
      ),
    };
  }

  if (response.status === 404 || (response.ok && !isObject)) {
    return {
      ok: false,
      stage: 'rest',
      problem: problem(
        'not-wordpress',
        '這個網址找不到 WordPress 的 REST API',
        `${siteUrl}/wp-json/ ${response.status === 404 ? '回 404' : '回的不是資料'}。可能這不是 WordPress 站的首頁網址，或站台的「永久連結」設成了「預設」（那種設定下 /wp-json/ 不存在）。`,
        PERMALINK_HINT,
      ),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      stage: 'reachable',
      problem: problem(
        'server-error',
        'WordPress 出錯了',
        `${siteUrl}/wp-json/ 回 HTTP ${response.status}。`,
        '過幾分鐘再測一次；一直這樣的話，到後台「工具 → 網站健康狀態」看有沒有錯誤。',
      ),
    };
  }

  const index = json as { namespaces?: unknown; authentication?: unknown };
  const namespaces = Array.isArray(index.namespaces) ? index.namespaces : [];
  if (!namespaces.includes('wp/v2')) {
    return {
      ok: false,
      stage: 'rest',
      problem: problem(
        'rest-blocked',
        'WordPress 的內容 API 被關掉了',
        '/wp-json/ 有回應，但裡面沒有 wp/v2（文章、頁面用的那一組 API）。通常是外掛把它關掉了。',
        '檢查安全外掛或「Disable REST API」類外掛的設定，允許 wp/v2，再測一次。',
      ),
    };
  }
  const auth = index.authentication;
  const advertised =
    auth !== null && typeof auth === 'object' && !Array.isArray(auth) && 'application-passwords' in auth;
  return { ok: true, probe: { appPasswordsAdvertised: advertised, anonymousBlocked: false } };
}

function appPasswordsDisabled(): SetupProblem {
  return problem(
    'app-passwords-disabled',
    '這個站停用了應用程式密碼',
    'WordPress 5.6 以後內建「應用程式密碼」，但這個站把它關掉了（常見於安全外掛的設定，或 WordPress 版本太舊）。沒有它，發布台就沒辦法用你的帳號發文。',
    '到安全外掛的設定打開「應用程式密碼」（Application Passwords），或請站台管理員打開；打開後到「使用者 → 個人資料」產生一組，再測一次。',
  );
}

/** `/users/me` 失敗 → 哪一種問題。 */
function describeAuthError(
  error: unknown,
  input: { siteUrl: string; username: string; index: IndexProbe },
  timeoutMs: number,
): { problem: SetupProblem; stage: SetupCheck['key'] } {
  if (!(error instanceof WordPressError)) {
    return { stage: 'reachable', problem: describeNetworkError(error, new URL(input.siteUrl).host, timeoutMs) };
  }
  const status = error.status;
  const code = error.options.wordpressCode ?? null;

  if (status === null) {
    return {
      stage: 'reachable',
      problem: describeNetworkError(error.options.cause ?? error, new URL(input.siteUrl).host, timeoutMs),
    };
  }
  if (status >= 300 && status < 400) {
    return {
      stage: 'reachable',
      problem: problem(
        'redirect',
        '網址會被轉到別的地方',
        '帶著帳號密碼的請求被轉址了。轉址時帳號密碼可能被丟掉。',
        '在瀏覽器打開這個網址，把最後停下來的網址（注意有沒有 www、是不是 https）填進來再測一次。',
      ),
    };
  }
  if (code === 'invalid_username' || code === 'invalid_email') {
    return {
      stage: 'auth',
      problem: problem(
        'wrong-username',
        '找不到這個帳號',
        `WordPress 說沒有「${input.username}」這個使用者。`,
        '填後台登入用的帳號（使用者名稱）或它的 email，再測一次。',
      ),
    };
  }
  if (code === 'incorrect_password' || code === 'invalid_application_password') {
    return {
      stage: 'auth',
      problem: problem(
        'wrong-password',
        '應用程式密碼不對',
        '帳號對，但這組應用程式密碼不對，或已經被撤銷。注意：重設 WordPress 登入密碼會讓所有應用程式密碼一起失效。',
        '到後台「使用者 → 個人資料 → 應用程式密碼」產生一組新的，整串複製貼上再測一次。',
      ),
    };
  }
  if (code === 'application_passwords_disabled' || code === 'application_passwords_disabled_for_user') {
    return { stage: 'auth', problem: appPasswordsDisabled() };
  }
  if (code === 'rest_not_logged_in' || (status === 401 && code === null && input.index.appPasswordsAdvertised === false)) {
    // WordPress 沒把這次請求當成登入：站上根本沒開應用程式密碼，或 Authorization 標頭在半路被拿掉。
    if (input.index.appPasswordsAdvertised === false) return { stage: 'auth', problem: appPasswordsDisabled() };
    return {
      stage: 'auth',
      problem: problem(
        'auth-header-stripped',
        'WordPress 沒收到帳號密碼',
        '請求有帶帳號密碼，WordPress 卻說沒有登入。最常見的原因是主機把 Authorization 標頭擋掉了（Apache 搭配 CGI／FastCGI 時很常見）' +
          (input.index.appPasswordsAdvertised === null ? '；也可能是站上關掉了應用程式密碼。' : '。'),
        '請主機商讓 Authorization 標頭傳給 PHP；自己改的話，在網站根目錄的 .htaccess 加一行 SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1，再測一次。',
      ),
    };
  }
  if (status === 401 || status === 403) {
    return {
      stage: 'rest',
      problem: problem(
        'rest-blocked',
        'REST API 被安全外掛擋住了',
        `帶著帳號密碼問「我是誰」（/wp/v2/users/me）被拒絕（HTTP ${status}${code ? `，${code}` : ''}）。安全外掛（Wordfence、Solid Security、All In One WP Security、Disable REST API 等）常會關掉 REST API，或專門擋使用者端點防止帳號被列舉。`,
        PLUGIN_HINT,
      ),
    };
  }
  if (status === 404) {
    return {
      stage: 'rest',
      problem: problem(
        'not-wordpress',
        '這個網址找不到 WordPress 的使用者 API',
        '/wp/v2/users/me 回 404。可能網址不是 WordPress 站的首頁，或使用者端點被外掛拿掉了。',
        PERMALINK_HINT,
      ),
    };
  }
  return {
    stage: 'auth',
    problem: problem(
      'server-error',
      'WordPress 出錯了',
      error.code === wordpressErrorCodes.SCHEMA_MISMATCH
        ? '問「我是誰」得到的回應格式不對，可能有外掛改掉了 REST 的回應。'
        : `問「我是誰」時 WordPress 回 HTTP ${status}。`,
      '過幾分鐘再測一次；一直這樣的話，到後台「工具 → 網站健康狀態」看有沒有錯誤。',
    ),
  };
}

const OVERPRIVILEGED = new Set(['administrator', 'super_admin']);

/**
 * 測試連線。整個過程只讀；任何一關失敗就停，後面的關卡標成沒跑。
 * 回傳前整份結果再過一次含這組密碼的遮蔽器（最後一道防線）。
 */
export async function diagnoseConnection(input: ConnectionInput, options: DiagnoseOptions = {}): Promise<DiagnoseOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const password = normalizeAppPassword(input.appPassword);
  const username = input.username.trim();
  const scrub = createSecretScrubber([input.appPassword, password]);

  const fail = (
    url: string | null,
    stage: SetupCheck['key'],
    found: SetupProblem,
    passed: Partial<Record<SetupCheck['key'], SetupCheck['state']>>,
    labels: Partial<Record<SetupCheck['key'], string>> = {},
    warnings: string[] = [],
  ): DiagnoseOutcome => ({
    result: scrub({
      ok: false,
      url,
      checks: checklist({ ...passed, [stage]: 'fail' }, labels),
      problem: found,
      warnings,
      identity: null,
    }),
    credentials: null,
  });

  const siteUrl = normalizeSiteUrl(input.url);
  if (siteUrl === null) {
    return fail(null, 'https', problem('invalid-url', '網址看不懂', `「${input.url.trim()}」不是網址。`, '填網站首頁的網址，例如 https://example.com。'), {});
  }
  const parsed = new URL(siteUrl);
  const loopback = isLoopbackHostname(parsed.hostname);
  const labels: Partial<Record<SetupCheck['key'], string>> =
    parsed.protocol === 'http:' && loopback ? { https: '本機測試站（http）' } : {};

  if (parsed.protocol === 'http:' && !loopback) {
    return fail(
      siteUrl,
      'https',
      problem(
        'not-https',
        '網址不是 https',
        '應用程式密碼會跟著每一個請求送出去；走 http 等於把密碼用明碼傳過網路。WordPress 預設也不讓 http 站使用應用程式密碼。',
        '把網址改成 https:// 開頭再測一次。站台還沒有 SSL 憑證的話，先到主機商後台開啟（多半有免費的 Let’s Encrypt）。',
      ),
      {},
    );
  }

  if (username.length === 0 || !APP_PASSWORD_PATTERN.test(password)) {
    const found =
      username.length === 0
        ? problem('wrong-username', '還沒填帳號', '帳號是空白的。', '填後台登入用的帳號（使用者名稱）或它的 email。')
        : problem(
            'password-format',
            '應用程式密碼的格式不對',
            `應用程式密碼是 24 個英文字母和數字（WordPress 顯示成 6 組、每組 4 個，空格有沒有都可以）；你貼上的是 ${password.length} 個字元。最常見的原因是貼成了登入密碼。`,
            '到後台「使用者 → 個人資料 → 應用程式密碼」產生一組新的，整串複製貼上。',
          );
    return fail(siteUrl, 'auth', found, { https: 'ok' }, labels);
  }

  const index = await probeIndex(siteUrl, fetchImpl, timeoutMs);
  if (!index.ok) {
    const passed: Partial<Record<SetupCheck['key'], SetupCheck['state']>> =
      index.stage === 'rest' ? { https: 'ok', reachable: 'ok' } : { https: 'ok' };
    return fail(siteUrl, index.stage, index.problem, passed, labels);
  }

  const warnings: string[] = [];
  if (index.probe.anonymousBlocked) {
    warnings.push('沒登入時 REST API 是關的（安全外掛常這樣設定）。發布台用帳號登入後可以用，不影響。');
  }

  const client = new WordPressClient({
    baseUrl: siteUrl,
    username,
    appPassword: password,
    maxRetries: 0,
    timeoutMs,
    fetchImpl,
  });

  let identity: SiteIdentity;
  try {
    identity = await fetchIdentity(client);
  } catch (error) {
    const described = describeAuthError(error, { siteUrl, username, index: index.probe }, timeoutMs);
    const passed: Partial<Record<SetupCheck['key'], SetupCheck['state']>> = { https: 'ok', reachable: 'ok' };
    if (described.stage === 'auth') passed.rest = index.probe.anonymousBlocked ? 'warn' : 'ok';
    return fail(siteUrl, described.stage, described.problem, passed, labels, warnings);
  }

  const passedAuth: Partial<Record<SetupCheck['key'], SetupCheck['state']>> = {
    https: 'ok',
    reachable: 'ok',
    rest: index.probe.anonymousBlocked ? 'warn' : 'ok',
    auth: 'ok',
  };
  const who = { name: identity.user.name, slug: identity.user.slug, roles: [...identity.roles] };
  const perms = permissionsOf(identity);

  if (!perms.canPublishPosts && !perms.canPublishPages) {
    const roles = identity.roles.join('、') || '（沒有角色）';
    const contributor = identity.roles.includes('contributor') ? '投稿者（Contributor）只能送審，不能發布。' : '';
    const outcome = fail(
      siteUrl,
      'permission',
      problem(
        'no-permission',
        '這個帳號不能發布',
        `「${identity.user.name}」的角色是 ${roles}，WordPress 不讓它發布文章或頁面（缺 publish_posts／publish_pages）。${contributor}`,
        '用管理員登入後台，到「使用者」把這個帳號的角色改成「編輯」（Editor），再測一次。',
      ),
      passedAuth,
      labels,
      warnings,
    );
    return { ...outcome, result: { ...outcome.result, identity: who } };
  }

  if (identity.roles.some((role) => OVERPRIVILEGED.has(role))) {
    warnings.push('這個帳號是管理員，權限比發布台需要的大。建議另開一個「編輯」（Editor）角色的帳號專門給發布台用。');
  }
  if (perms.canPublishPosts && !perms.canPublishPages) {
    warnings.push('這個帳號只能發文章、不能發頁面（「作者」角色就是這樣）。要發頁面得改成「編輯」。');
  }
  if (!perms.canUpload) {
    warnings.push('這個帳號不能上傳圖片（缺 upload_files），配圖與封面會失敗。');
  }

  let types: Record<string, PostType>;
  try {
    types = await fetchPostTypes(client);
    await fetchTaxonomies(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = fail(
      siteUrl,
      'types',
      problem(
        'server-error',
        '讀不到站上的內容類型',
        `問 WordPress 有哪些內容類型時失敗了：${message}`,
        '過幾分鐘再測一次；一直這樣的話，檢查安全外掛有沒有擋 /wp/v2/types 或 /wp/v2/taxonomies。',
      ),
      { ...passedAuth, permission: 'ok' },
      labels,
      warnings,
    );
    return { ...outcome, result: { ...outcome.result, identity: who } };
  }

  if (!types['post'] && !types['page']) {
    const outcome = fail(
      siteUrl,
      'types',
      problem(
        'types-missing',
        '站上的文章和頁面都沒有開放 REST',
        '/wp/v2/types 裡找不到 post，也找不到 page。發布台沒有地方可以發。',
        '通常是外掛把它們從 REST 拿掉了；檢查安全外掛或「Disable REST API」類外掛的設定，再測一次。',
      ),
      { ...passedAuth, permission: 'ok' },
      labels,
      warnings,
    );
    return { ...outcome, result: { ...outcome.result, identity: who } };
  }

  return {
    result: scrub({
      ok: true,
      url: siteUrl,
      checks: checklist({ ...passedAuth, permission: 'ok', types: 'ok' }, labels),
      problem: null,
      warnings,
      identity: who,
    }),
    credentials: { url: siteUrl, username, appPassword: password },
  };
}

// --- 目的地 ------------------------------------------------------------------

const DESTINATIONS: Record<SetupDestinationKey, { displayName: string; postType: string; taxonomy: string | null }> = {
  post: { displayName: '文章', postType: 'post', taxonomy: 'category' },
  page: { displayName: '頁面', postType: 'page', taxonomy: null },
};

export const DESTINATION_KEYS: readonly SetupDestinationKey[] = ['post', 'page'];

/** 站上實際有什麼 → 精靈第三步的兩個選項。 */
export function destinationOptions(
  types: Readonly<Record<string, PostType>>,
  taxonomies: Readonly<Record<string, Taxonomy>>,
  perms: SitePermissions,
  existing: readonly PublishTargetSummary[],
): SetupDestinationOption[] {
  return DESTINATION_KEYS.map((key) => {
    const spec = DESTINATIONS[key];
    const type = types[spec.postType];
    const canPublish = key === 'post' ? perms.canPublishPosts : perms.canPublishPages;
    const taxonomy =
      type && spec.taxonomy !== null && type.taxonomies.includes(spec.taxonomy) && taxonomies[spec.taxonomy]
        ? taxonomies[spec.taxonomy]!
        : null;
    let reason: string | null = null;
    if (!type) {
      reason = `站上的「${spec.displayName}」沒有開放 REST（/wp/v2/types 裡沒有 ${spec.postType}），選不了。通常是外掛把它從 REST 拿掉了。`;
    } else if (!canPublish) {
      reason = `這個帳號不能發布${spec.displayName}（缺 publish_${spec.postType}s）。要發的話，到後台把帳號改成「編輯」（Editor）。`;
    }
    return {
      key,
      displayName: spec.displayName,
      postType: spec.postType,
      available: reason === null,
      reason,
      restBase: type?.rest_base ?? null,
      taxonomy: taxonomy ? taxonomy.slug : null,
      taxonomyRestBase: taxonomy ? taxonomy.rest_base : null,
      existing: existing.find((target) => target.key === key) ?? null,
    };
  });
}

/**
 * 一個 target 寫進設定檔的樣子。欄位順序照 `config/publish-targets.example.json`，
 * 沒有分類法時不寫 `taxonomyRestBase`（範例的 page 就是這樣）。D-004：allowCreateTerms 一律 false。
 */
export function setupTargetJson(option: SetupDestinationOption): Record<string, unknown> {
  if (option.restBase === null) throw new PublishTargetError(`${option.displayName} 在站上沒有 REST，不能加入`);
  return {
    key: option.key,
    displayName: option.displayName,
    contentType: 'article',
    postType: option.postType,
    restBase: option.restBase,
    templateId: 'article-v1',
    taxonomy: option.taxonomy,
    ...(option.taxonomy === null ? {} : { taxonomyRestBase: option.taxonomyRestBase }),
    fixedObjectId: null,
    allowCreate: true,
    allowUpdate: true,
    allowCreateTerms: false,
    requireFeaturedImage: false,
    requireSecondConfirmation: false,
  };
}

// --- 站台設定檔 ----------------------------------------------------------------

export class SetupConflictError extends Error {
  override readonly name = 'SetupConflictError';
}

export interface ExistingSiteConfig {
  readonly exists: boolean;
  /** 檔案裡的原樣（沒補預設值），寫回去時不會多出使用者沒寫過的欄位。 */
  readonly rawTargets: Record<string, unknown>[];
  /** 站台共用的預設作者（P5-T024）。精靈重寫檔案時要原樣帶回去，不然會被洗掉。 */
  readonly defaultAuthorId: number | null;
}

/** 讀現在磁碟上的站台設定檔。壞掉的檔不碰，丟錯讓使用者先處理。 */
export async function readSiteConfig(file: string): Promise<ExistingSiteConfig> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return { exists: false, rawTargets: [], defaultAuthorId: null };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SetupConflictError(
      '現有的 config/publish-targets.json 不是合法 JSON。精靈不會覆寫壞掉的檔：先修好或把它移走，再回來設定。',
    );
  }
  if (!PublishTargetsFileSchema.safeParse(parsed).success) {
    throw new SetupConflictError(
      '現有的 config/publish-targets.json 格式不對。精靈不會覆寫壞掉的檔：先修好或把它移走，再回來設定。',
    );
  }
  const config = parsed as { targets: Record<string, unknown>[]; defaultAuthorId?: number };
  return { exists: true, rawTargets: config.targets, defaultAuthorId: config.defaultAuthorId ?? null };
}

/**
 * 合併：既有的 target 原樣保留（順序不變）；精靈要加的 key 已經存在時，必須在 replace 裡
 * 才取代，否則整個拒絕——不默默覆蓋使用者自己寫的設定。
 */
export function mergeSiteTargets(
  existing: readonly Record<string, unknown>[],
  additions: readonly Record<string, unknown>[],
  replace: readonly string[],
): Record<string, unknown>[] {
  const out = [...existing];
  for (const addition of additions) {
    const index = out.findIndex((target) => target['key'] === addition['key']);
    if (index === -1) {
      out.push(addition);
      continue;
    }
    if (!replace.includes(String(addition['key']))) {
      throw new SetupConflictError(
        `設定檔裡已經有「${String(out[index]!['displayName'] ?? addition['key'])}」（key: ${String(addition['key'])}）。要換成精靈產生的設定，請勾選「取代」。`,
      );
    }
    out[index] = addition;
  }
  return out;
}

/**
 * 寫站台設定檔。寫之前再用正式的 schema 驗一次；已經有檔就先複製一份到 backupsDir。
 * 回傳備份檔的路徑（相對 rootDir），沒有備份是 null。
 */
export async function writeSiteConfig(
  file: string,
  targets: readonly Record<string, unknown>[],
  options: {
    backupsDir: string;
    rootDir: string;
    hadFile: boolean;
    now?: Date;
    /** 檔案裡原本的預設作者（readSiteConfig 讀到的）。null／不給＝不寫這個欄位。 */
    defaultAuthorId?: number | null;
  },
): Promise<string | null> {
  const defaultAuthorId = options.defaultAuthorId ?? null;
  const content = defaultAuthorId === null ? { targets } : { defaultAuthorId, targets };
  const check = PublishTargetsFileSchema.safeParse(content);
  if (!check.success) {
    const issues = check.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new PublishTargetError(`精靈產生的設定不合法：\n- ${issues.join('\n- ')}`);
  }

  let backup: string | null = null;
  if (options.hadFile) {
    await mkdir(options.backupsDir, { recursive: true });
    // 時間到毫秒再加亂數，而且不准覆蓋既有檔（COPYFILE_EXCL）：同一秒存兩次不能把第一份備份蓋掉。
    const stamp = (options.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '');
    backup = join(options.backupsDir, `publish-targets-${stamp}-${randomBytes(3).toString('hex')}.json`);
    await copyFile(file, backup, fsConstants.COPYFILE_EXCL);
  }
  await writeFileAtomic(file, `${JSON.stringify(content, null, 2)}\n`, 0o644);
  return backup === null ? null : relative(options.rootDir, backup);
}
