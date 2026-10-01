/** 設定精靈與發布目標（對應後端 `service/setup.ts` 與 `/api/setup/*`）。 */

import { isOpenJobState } from '../../../contract/job-states.js';
import type {
  PublishTargetSummary,
  PublisherApi,
  SetupAgent,
  SetupCheck,
  SetupConnectionResult,
  SetupProblem,
  SetupProblemKind,
} from '../types.js';
import { DIARY_TARGET, LONGFORM_TARGET, PAGE_TARGET, POST_TARGET } from './data.js';
import { store } from './store.js';
import { clone, delay } from './context.js';

// --- 設定精靈的示範資料（P8-T002）------------------------------------------------
//
// `?fixtures=1&setup=needed` 模擬「什麼都還沒設定」（會自動進精靈）；不加就是「已經設定好、從設定頁重跑」，
// 設定檔裡已經有四個目標，所以第三步看得到「已經有、要不要取代」。
// 測試連線的結果由精靈畫面上（只在示範模式出現）的下拉選單決定，每一種失敗都看得到。

interface FixtureSetupState {
  needsSetup: boolean;
  wordpress: { url: string; username: string } | null;
  siteConfig: { exists: boolean; targets: PublishTargetSummary[] };
  canWrite: boolean;
}

let fixtureSetup: FixtureSetupState | null = null;

function setupState(): FixtureSetupState {
  if (fixtureSetup) return fixtureSetup;
  const fresh = new URLSearchParams(window.location.search).get('setup') === 'needed';
  fixtureSetup = fresh
    ? { needsSetup: true, wordpress: null, siteConfig: { exists: false, targets: [] }, canWrite: true }
    : {
        needsSetup: false,
        wordpress: { url: 'https://example.com', username: 'ming' },
        siteConfig: { exists: true, targets: [LONGFORM_TARGET, DIARY_TARGET, POST_TARGET, PAGE_TARGET] },
        canWrite: true,
      };
  return fixtureSetup;
}

/** 新稿件選單、總覽看到的類型：有設定檔就跟精靈改過的一致（含停用狀態），還沒設定就用預設四個。 */
export function fixtureTargets(): PublishTargetSummary[] {
  const state = setupState();
  return state.siteConfig.exists ? state.siteConfig.targets : [LONGFORM_TARGET, DIARY_TARGET, POST_TARGET, PAGE_TARGET];
}

const FIXTURE_TEST_ID = 'fixture-test-id';
let lastTestedUrl = 'https://example.com';

export type FixtureSetupScenario = 'ok' | 'ok-site-change' | SetupProblemKind;

export const FIXTURE_SETUP_SCENARIOS: { key: FixtureSetupScenario; label: string }[] = [
  { key: 'ok', label: '全部通過' },
  { key: 'ok-site-change', label: '通過，但換了站（舊站有發過文）' },
  { key: 'not-https', label: '不是 https' },
  { key: 'unreachable', label: '連不上（DNS）' },
  { key: 'redirect', label: '會被轉址' },
  { key: 'not-wordpress', label: '找不到 REST API' },
  { key: 'rest-blocked', label: 'REST 被安全外掛擋' },
  { key: 'app-passwords-disabled', label: '應用程式密碼被停用' },
  { key: 'auth-header-stripped', label: 'Authorization 被主機拿掉' },
  { key: 'wrong-username', label: '帳號不存在' },
  { key: 'wrong-password', label: '密碼不對' },
  { key: 'password-format', label: '密碼格式不對' },
  { key: 'no-permission', label: '權限不夠發文' },
  { key: 'types-missing', label: '文章頁面都沒開 REST' },
];

let fixtureSetupScenario: FixtureSetupScenario = 'ok';

export function setFixtureSetupScenario(key: FixtureSetupScenario): void {
  fixtureSetupScenario = key;
}

const FIXTURE_PROBLEMS: Partial<Record<SetupProblemKind, { stage: SetupCheck['key']; problem: SetupProblem }>> = {
  'not-https': {
    stage: 'https',
    problem: {
      kind: 'not-https',
      title: '網址不是 https',
      detail: '應用程式密碼會跟著每一個請求送出去；走 http 等於把密碼用明碼傳過網路。WordPress 預設也不讓 http 站使用應用程式密碼。',
      next: '把網址改成 https:// 開頭再測一次。站台還沒有 SSL 憑證的話，先到主機商後台開啟（多半有免費的 Let’s Encrypt）。',
    },
  },
  unreachable: {
    stage: 'reachable',
    problem: {
      kind: 'unreachable',
      title: '找不到這個網站',
      detail: '查不到「exmaple.com」的位址（DNS 找不到）。可能是網址打錯，或網域剛設定還沒生效。',
      next: '在瀏覽器打開這個網址確認拼字；網域剛買或剛改 DNS 的話，等幾個小時再試。',
    },
  },
  redirect: {
    stage: 'reachable',
    problem: {
      kind: 'redirect',
      title: '網址會被轉到別的地方',
      detail: '「https://example.com」會被轉到「https://www.example.com」。轉址時帳號密碼可能被丟掉，會出現「密碼明明對卻說沒權限」。',
      next: '把網址改成「https://www.example.com」再測一次。',
    },
  },
  'not-wordpress': {
    stage: 'rest',
    problem: {
      kind: 'not-wordpress',
      title: '這個網址找不到 WordPress 的 REST API',
      detail: 'https://example.com/wp-json/ 回 404。可能這不是 WordPress 站的首頁網址，或站台的「永久連結」設成了「預設」（那種設定下 /wp-json/ 不存在）。',
      next: '確認填的是 WordPress 站的首頁網址（WordPress 裝在子目錄的話要包含子目錄）。是的話，到後台「設定 → 永久連結」選「文章名稱」並儲存，再測一次。',
    },
  },
  'rest-blocked': {
    stage: 'rest',
    problem: {
      kind: 'rest-blocked',
      title: 'REST API 被安全外掛擋住了',
      detail: '帶著帳號密碼問「我是誰」（/wp/v2/users/me）被拒絕（HTTP 403，rest_forbidden）。安全外掛（Wordfence、Solid Security、All In One WP Security、Disable REST API 等）常會關掉 REST API，或專門擋使用者端點防止帳號被列舉。',
      next: '到那個外掛的設定裡允許 REST API（至少對登入的使用者），或把 /wp/v2/users 從封鎖清單拿掉，再測一次。',
    },
  },
  'app-passwords-disabled': {
    stage: 'auth',
    problem: {
      kind: 'app-passwords-disabled',
      title: '這個站停用了應用程式密碼',
      detail: 'WordPress 5.6 以後內建「應用程式密碼」，但這個站把它關掉了（常見於安全外掛的設定，或 WordPress 版本太舊）。沒有它，發布台就沒辦法用你的帳號發文。',
      next: '到安全外掛的設定打開「應用程式密碼」（Application Passwords），或請站台管理員打開；打開後到「使用者 → 個人資料」產生一組，再測一次。',
    },
  },
  'auth-header-stripped': {
    stage: 'auth',
    problem: {
      kind: 'auth-header-stripped',
      title: 'WordPress 沒收到帳號密碼',
      detail: '請求有帶帳號密碼，WordPress 卻說沒有登入。最常見的原因是主機把 Authorization 標頭擋掉了（Apache 搭配 CGI／FastCGI 時很常見）。',
      next: '請主機商讓 Authorization 標頭傳給 PHP；自己改的話，在網站根目錄的 .htaccess 加一行 SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1，再測一次。',
    },
  },
  'wrong-username': {
    stage: 'auth',
    problem: {
      kind: 'wrong-username',
      title: '找不到這個帳號',
      detail: 'WordPress 說沒有「ming」這個使用者。',
      next: '填後台登入用的帳號（使用者名稱）或它的 email，再測一次。',
    },
  },
  'wrong-password': {
    stage: 'auth',
    problem: {
      kind: 'wrong-password',
      title: '應用程式密碼不對',
      detail: '帳號對，但這組應用程式密碼不對，或已經被撤銷。注意：重設 WordPress 登入密碼會讓所有應用程式密碼一起失效。',
      next: '到後台「使用者 → 個人資料 → 應用程式密碼」產生一組新的，整串複製貼上再測一次。',
    },
  },
  'password-format': {
    stage: 'auth',
    problem: {
      kind: 'password-format',
      title: '應用程式密碼的格式不對',
      detail: '應用程式密碼是 24 個英文字母和數字（WordPress 顯示成 6 組、每組 4 個，空格有沒有都可以）；你貼上的是 12 個字元。最常見的原因是貼成了登入密碼。',
      next: '到後台「使用者 → 個人資料 → 應用程式密碼」產生一組新的，整串複製貼上。',
    },
  },
  'no-permission': {
    stage: 'permission',
    problem: {
      kind: 'no-permission',
      title: '這個帳號不能發布',
      detail: '「編輯小明」的角色是 contributor，WordPress 不讓它發布文章或頁面（缺 publish_posts／publish_pages）。投稿者（Contributor）只能送審，不能發布。',
      next: '用管理員登入後台，到「使用者」把這個帳號的角色改成「編輯」（Editor），再測一次。',
    },
  },
  'types-missing': {
    stage: 'types',
    problem: {
      kind: 'types-missing',
      title: '站上的文章和頁面都沒有開放 REST',
      detail: '/wp/v2/types 裡找不到 post，也找不到 page。發布台沒有地方可以發。',
      next: '通常是外掛把它們從 REST 拿掉了；檢查安全外掛或「Disable REST API」類外掛的設定，再測一次。',
    },
  },
};

const CHECK_KEYS: SetupCheck['key'][] = ['https', 'reachable', 'rest', 'auth', 'permission', 'types'];
const CHECK_LABELS: Record<SetupCheck['key'], string> = {
  https: '網址是 https',
  reachable: '連得上網站',
  rest: 'REST API 開著',
  auth: '帳號與應用程式密碼正確',
  permission: '帳號可以發布',
  types: '文章／頁面有開放 REST',
};

function fixtureConnectionResult(scenario: FixtureSetupScenario, url: string): SetupConnectionResult {
  lastTestedUrl = url.trim() === '' ? 'https://example.com' : url.trim();
  const found = scenario === 'ok' || scenario === 'ok-site-change' ? null : FIXTURE_PROBLEMS[scenario] ?? null;
  const failAt = found ? CHECK_KEYS.indexOf(found.stage) : CHECK_KEYS.length;
  const checks = CHECK_KEYS.map((key, index) => ({
    key,
    label: CHECK_LABELS[key],
    state: (index < failAt ? 'ok' : index === failAt ? 'fail' : 'skipped') as SetupCheck['state'],
  }));
  const identity = failAt > CHECK_KEYS.indexOf('auth') ? { name: '編輯小明', slug: 'ming', roles: [found ? 'contributor' : 'editor'] } : null;
  return {
    ok: found === null,
    url: lastTestedUrl,
    checks,
    problem: found?.problem ?? null,
    warnings: [],
    identity,
    testId: found === null ? FIXTURE_TEST_ID : null,
    siteChange:
      scenario === 'ok-site-change'
        ? { from: 'https://old.example.com', to: lastTestedUrl, publishedJobs: 12, uploadedMedia: 5 }
        : null,
  };
}

const FIXTURE_SETUP_AGENTS: SetupAgent[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    installed: true,
    version: 'codex-cli 0.153.4',
    loginState: 'logged-in',
    available: true,
    unavailableReason: null,
    canGenerateImages: true,
    installCommand: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    installNote: '要有 ChatGPT 付費訂閱（Plus 以上）。用 Homebrew 的話也可以 brew install codex。',
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    installed: true,
    version: '2.1.247',
    loginState: 'logged-out',
    available: false,
    unavailableReason: '尚未登入，請執行 `claude auth login`',
    canGenerateImages: false,
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude auth login',
    installNote: '要有 Claude 付費訂閱（Pro 以上）。',
  },
  {
    id: 'google',
    displayName: 'Antigravity',
    installed: false,
    version: null,
    loginState: 'unknown',
    available: false,
    unavailableReason: '找不到 agy，請先安裝官方 CLI 並確認它在 PATH 上',
    canGenerateImages: false,
    installCommand: '從 https://antigravity.google 下載安裝 Antigravity',
    loginCommand: 'agy models',
    installNote: '裝好後終端機要找得到 agy 指令。第一次跑 agy 會要你登入 Google 帳號；agy models 列得出模型就代表登入好了。',
  },
];

export const setupApi: Pick<PublisherApi, 'listTargets' | 'getSetupStatus' | 'testWordPressConnection' | 'saveWordPressConnection' | 'getSetupAgents' | 'getSetupDestinations' | 'saveSetupDestinations'> = {
  async listTargets() {
    await delay(80);
    return clone(fixtureTargets());
  },

  async getSetupStatus() {
    await delay(80);
    return clone(setupState());
  },

  async testWordPressConnection(input) {
    await delay(900);
    return fixtureConnectionResult(fixtureSetupScenario, input.url);
  },

  async saveWordPressConnection(testId, confirmSiteChange) {
    await delay(300);
    if (testId !== FIXTURE_TEST_ID) throw new Error('這次的測試結果已經失效，請再按一次「測試連線」。');
    if (fixtureSetupScenario === 'ok-site-change' && confirmSiteChange !== true) {
      throw new Error('要換站：舊站上的稿件與圖不會跟過去。確認之後再存。');
    }
    const state = setupState();
    state.wordpress = { url: lastTestedUrl, username: 'ming' };
    state.needsSetup = !state.siteConfig.exists;
    return { saved: true as const, restartRequired: false, backupFile: null, status: clone(state) };
  },

  async getSetupAgents() {
    await delay(700);
    return clone(FIXTURE_SETUP_AGENTS);
  },

  async getSetupDestinations() {
    await delay(400);
    const existing = setupState().siteConfig.targets;
    const openJobs: Record<string, number> = {};
    for (const job of store.values()) {
      if (!isOpenJobState(job.state)) continue;
      openJobs[job.target.key] = (openJobs[job.target.key] ?? 0) + 1;
    }
    return {
      existing: clone(existing),
      openJobs,
      options: [
        {
          key: 'post' as const,
          displayName: '文章',
          postType: 'post',
          available: true,
          reason: null,
          restBase: 'posts',
          taxonomy: 'category',
          taxonomyRestBase: 'categories',
          existing: existing.find((target) => target.key === 'post') ?? null,
        },
        {
          key: 'page' as const,
          displayName: '頁面',
          postType: 'page',
          available: true,
          reason: null,
          restBase: 'pages',
          taxonomy: null,
          taxonomyRestBase: null,
          existing: existing.find((target) => target.key === 'page') ?? null,
        },
      ],
    };
  },

  async saveSetupDestinations(input) {
    await delay(400);
    const state = setupState();
    const had = state.siteConfig.exists;
    for (const key of input.include) {
      const target = key === 'post' ? POST_TARGET : PAGE_TARGET;
      const index = state.siteConfig.targets.findIndex((item) => item.key === key);
      if (index === -1) state.siteConfig.targets.push(target);
      // 取代時保留原本的停用狀態，跟後端 mergeSiteTargets 一樣（P5-T032）。
      else if (input.replace.includes(key)) state.siteConfig.targets[index] = { ...target, disabled: state.siteConfig.targets[index]!.disabled };
      else throw new Error(`設定檔裡已經有「${target.displayName}」（key: ${key}）。要換成精靈產生的設定，請勾選「取代」。`);
    }
    // 停用清單（P5-T032）：規則跟後端 applyDisabledTargets 一樣。
    if (input.disabled !== undefined) {
      const wanted = new Set(input.disabled);
      if (state.siteConfig.targets.every((item) => wanted.has(item.key))) {
        throw new Error('至少要留一個類型不停用，不然沒有地方可以建新稿。');
      }
      state.siteConfig.targets = state.siteConfig.targets.map((item) => ({ ...item, disabled: wanted.has(item.key) }));
    }
    state.siteConfig.exists = true;
    state.needsSetup = state.wordpress === null;
    return {
      saved: true as const,
      restartRequired: false,
      backupFile: had ? 'backups/publish-targets-20260924-101500.json' : null,
      status: clone(state),
    };
  },
};
