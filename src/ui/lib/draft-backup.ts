import type { JobState } from '../service/types.js';
import type { RichEditResult, RichNode } from '../../contract/rich-text.js';

/**
 * 打字模式沒存的內容自動留底（D-047，P5-T048）：規則都在這裡，接 iframe 與 React 在 `use-draft-backup.ts`。
 *
 * 原則：**任何順序都不能讓使用者打的字不見**（審查）。
 * - 打字模式中標題或內文一動，節流寫一份到瀏覽器儲存區（localStorage）。**每一次打字（session）一個鍵**
 *   （`galley.draft.v2.<uuid>/<id>`）：還沒處理的舊留底不會被新的一次打字蓋掉；同一篇可以有好幾份。
 *   恢復一份留底時，那次打字接手它的鍵（之後的變動寫回同一份）。
 * - 內容：標題、內文 HTML（編輯區原樣）、寫下時間、這次打字的基準 contentHash（存檔的 `expectedContentHash`）。
 * - 只進這台電腦的瀏覽器儲存區，不送後端、不寫 log；存不存成正式版本照舊由使用者按「儲存」決定。
 * - 儲存區不能用（無痕、被擋、滿了）一律不丟錯：寫回 false；滿了照樣讀得到、刪得掉。
 */

/** 儲存區要用到的那幾個方法（`window.localStorage` 符合；測試用記憶體版）。 */
export interface DraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftBackup {
  readonly v: 2;
  readonly uuid: string;
  /** 哪一次打字（同一篇的留底各自一個鍵）。 */
  readonly id: string;
  /** 標題元素的字；null＝校樣沒有標題元素。 */
  readonly title: string | null;
  /** 編輯區（`.preview-body`）的 innerHTML，原樣；填回之前才整理。 */
  readonly body: string;
  /** 寫下的時間（epoch ms）。 */
  readonly savedAt: number;
  /** 這次打字的基準 contentHash（打字中先存過就是最後存成功的那一版）。 */
  readonly baseHash: string | null;
  /**
   * 這份是從哪幾份留底恢復來的（來源鏈，近的在前；Codex 第一輪 2）：恢復之後使用者打了字，才寫進自己的新鍵，不接手別人的鍵。
   * 讀留底時，來源有副本指著、寫下時間沒變就先不提示（`visibleDrafts`，隱藏不刪）；副本消失後來源重新出現。
   */
  readonly from: readonly DraftOrigin[];
}

export interface DraftOrigin {
  readonly id: string;
  readonly savedAt: number;
}

export const DRAFT_KEY_PREFIX = 'galley.draft.v2.';
/** 「已捨棄」標記（Codex 第二輪）：`<uuid>/<id>/<savedAt>` → `{ at }`。跟留底的鍵分開，30 天過期一起清。 */
export const DISMISS_KEY_PREFIX = 'galley.draft-dismissed.v1.';
/** 打字中最多每隔這麼久寫一次（第一下立刻寫）。 */
export const DRAFT_WRITE_WAIT_MS = 800;
/** 超過這麼久的留底在載入時清掉。 */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const DRAFT_UNAVAILABLE_NOTE = '這個視窗沒辦法自動留底，記得常按儲存。';
/** 「恢復」問過來、但內容跟現在這一版一樣時講的話。 */
export const DRAFT_SAME_NOTE = '沒存的內容跟現在這一版一樣，不用恢復。';
/** 打字中已經打了字，又按「恢復」另一份：不准默默換掉（審查 2）。 */
export const DRAFT_RESTORE_WHILE_TYPING_NOTE = '這次已經打了字：先按「儲存」或「取消」，再恢復這份。';

export function draftKey(uuid: string, id: string): string {
  return `${DRAFT_KEY_PREFIX}${uuid}/${id}`;
}

/** 鍵 → 哪一篇、哪一份；不是本功能的鍵回 null。 */
export function parseDraftKey(key: string): { uuid: string; id: string } | null {
  if (!key.startsWith(DRAFT_KEY_PREFIX)) return null;
  const rest = key.slice(DRAFT_KEY_PREFIX.length);
  const slash = rest.lastIndexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { uuid: rest.slice(0, slash), id: rest.slice(slash + 1) };
}

/** 新的一次打字用的 id（時間＋亂數，同一毫秒兩個分頁也分得開）。 */
export function newDraftId(now: number, random: () => number = Math.random): string {
  return `${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36)}`;
}

/** 讀回來的字串 → 留底；壞掉、形狀不對、鍵跟內容對不上都當成沒有。 */
export function parseDraft(raw: string | null, uuid: string, id: string): DraftBackup | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (o.v !== 2 || o.uuid !== uuid || o.id !== id || typeof o.body !== 'string') return null;
  if (typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null;
  if (o.title !== null && typeof o.title !== 'string') return null;
  if (o.baseHash !== null && typeof o.baseHash !== 'string') return null;
  const from = o.from === undefined ? [] : o.from;
  if (!Array.isArray(from) || !from.every(isOrigin)) return null;
  return { v: 2, uuid, id, title: o.title, body: o.body, savedAt: o.savedAt, baseHash: o.baseHash, from: from.map((f) => ({ id: f.id, savedAt: f.savedAt })) };
}

function isOrigin(value: unknown): value is DraftOrigin {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.savedAt === 'number' && Number.isFinite(o.savedAt);
}

/** 恢復 `source` 時新的那份要記的來源鏈：它自己（寫下時間是讀到那一刻的）＋它的來源。 */
export function restoredLineage(source: DraftBackup): DraftOrigin[] {
  return [{ id: source.id, savedAt: source.savedAt }, ...source.from];
}

/** 刪掉來源鏈裡寫下時間沒變的那幾份（只在存檔成功、送出之後沒再打字時：那份內容已經改好存進去了）；被寫過的留著。 */
export function removeAncestors(storage: DraftStorage | null, uuid: string, from: readonly DraftOrigin[]): void {
  for (const origin of from) {
    const stored = readDraft(storage, uuid, origin.id);
    if (stored !== null && stored.savedAt === origin.savedAt) removeDraft(storage, uuid, origin.id);
  }
}

export function readDraft(storage: DraftStorage | null, uuid: string, id: string): DraftBackup | null {
  if (storage === null) return null;
  try {
    return parseDraft(storage.getItem(draftKey(uuid, id)), uuid, id);
  } catch {
    return null;
  }
}

/** 這一篇的所有留底，新的在前。 */
export function readDrafts(storage: DraftStorage | null, uuid: string): DraftBackup[] {
  if (storage === null) return [];
  try {
    const out: DraftBackup[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      const parsed = key === null ? null : parseDraftKey(key);
      if (key === null || parsed === null || parsed.uuid !== uuid) continue;
      const draft = parseDraft(storage.getItem(key), parsed.uuid, parsed.id);
      if (draft !== null) out.push(draft);
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** 寫進去；寫不進去（被擋、滿了）回 false。 */
export function writeDraft(storage: DraftStorage | null, draft: DraftBackup): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(draftKey(draft.uuid, draft.id), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(storage: DraftStorage | null, uuid: string, id: string): void {
  if (storage === null) return;
  try {
    storage.removeItem(draftKey(uuid, id));
  } catch {
    /* 刪不掉就算了：過期會清。 */
  }
}

type DraftContent = Pick<DraftBackup, 'savedAt' | 'body' | 'title'>;

/** 兩份留底（含寫下時間）是不是同一份：刪之前確認儲存區那份還是自己最後寫的（審查 3：別的分頁可能寫過）。 */
export function sameDraft(a: DraftContent | null, b: DraftContent | null): boolean {
  return a !== null && b !== null && a.savedAt === b.savedAt && a.body === b.body && a.title === b.title;
}

/** 只在儲存區那份還是 `expected` 時才刪。回傳有沒有刪。 */
export function removeDraftIfSame(storage: DraftStorage | null, expected: DraftBackup): boolean {
  if (!sameDraft(readDraft(storage, expected.uuid, expected.id), expected)) return false;
  removeDraft(storage, expected.uuid, expected.id);
  return true;
}

function dismissKey(uuid: string, origin: DraftOrigin): string {
  return `${DISMISS_KEY_PREFIX}${uuid}/${origin.id}/${origin.savedAt}`;
}

function parseDismissKey(key: string): { uuid: string; origin: DraftOrigin } | null {
  if (!key.startsWith(DISMISS_KEY_PREFIX)) return null;
  const parts = key.slice(DISMISS_KEY_PREFIX.length).split('/');
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null;
  const savedAt = Number(parts[2]);
  if (!Number.isFinite(savedAt)) return null;
  return { uuid: parts[0], origin: { id: parts[1], savedAt } };
}

/** 記下「這份（這個寫下時間的）已經捨棄」：之後不再提示；被再寫過（寫下時間變了）照常提示。不刪留底本身。 */
export function markDismissed(storage: DraftStorage | null, uuid: string, origin: DraftOrigin, now: number): void {
  if (storage === null) return;
  try {
    storage.setItem(dismissKey(uuid, origin), JSON.stringify({ at: now }));
  } catch {
    /* 記不住：下次照樣會問，不掉字。 */
  }
}

export function readDismissed(storage: DraftStorage | null, uuid: string): DraftOrigin[] {
  if (storage === null) return [];
  try {
    const out: DraftOrigin[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      const parsed = key === null ? null : parseDismissKey(key);
      if (parsed !== null && parsed.uuid === uuid) out.push(parsed.origin);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 捨棄／取消一次打字時要記的標記（Codex 第二輪）：只有「恢復了來源但還沒打字」才記，記直接來源那一份。
 * 打過字的只刪自己的鍵；來源之後重新出現在提示裡（不掉字）。
 */
export function dismissOnDiscard(session: { readonly wrote: boolean; readonly from: readonly DraftOrigin[] }): DraftOrigin | null {
  return !session.wrote && session.from.length > 0 ? session.from[0]! : null;
}

/** 清掉超過 30 天與壞掉的留底（只看本功能的鍵），以及 30 天前記的、或對不上任何留底的「已捨棄」標記。回傳清掉幾個鍵。 */
export function pruneDrafts(storage: DraftStorage | null, now: number): number {
  if (storage === null) return 0;
  try {
    const stale: string[] = [];
    const alive = new Set<string>();
    const markers: { key: string; uuid: string; origin: DraftOrigin }[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key === null) continue;
      if (key.startsWith(DISMISS_KEY_PREFIX)) {
        const parsed = parseDismissKey(key);
        if (parsed === null) stale.push(key);
        else markers.push({ key, ...parsed });
        continue;
      }
      if (!key.startsWith(DRAFT_KEY_PREFIX)) continue;
      const parsed = parseDraftKey(key);
      const draft = parsed === null ? null : parseDraft(storage.getItem(key), parsed.uuid, parsed.id);
      if (draft === null || isExpired(draft, now)) stale.push(key);
      else alive.add(`${draft.uuid}/${draft.id}/${draft.savedAt}`);
    }
    for (const marker of markers) {
      let at = Number.NaN;
      try {
        at = (JSON.parse(storage.getItem(marker.key) ?? 'null') as { at?: unknown } | null)?.at as number;
      } catch {
        /* 壞掉的標記清掉。 */
      }
      const expired = typeof at !== 'number' || !Number.isFinite(at) || now - at > DRAFT_MAX_AGE_MS;
      if (expired || !alive.has(`${marker.uuid}/${marker.origin.id}/${marker.origin.savedAt}`)) stale.push(marker.key);
    }
    for (const key of stale) storage.removeItem(key);
    return stale.length;
  } catch {
    return 0;
  }
}

/**
 * 讀留底時哪些要提示（Codex 第二輪：隱藏不刪）：
 * - 有「已捨棄」標記、寫下時間對得上的：不提示。
 * - 有（沒被捨棄的）副本指著、寫下時間沒變的來源：不提示，只處理副本；副本被存檔成功或捨棄而消失後，來源重新出現。
 */
export function visibleDrafts(
  drafts: readonly DraftBackup[],
  dismissed: readonly DraftOrigin[],
): { candidates: DraftBackup[]; hidden: DraftBackup[] } {
  const tag = (o: DraftOrigin): string => `${o.id}\u0000${o.savedAt}`;
  const gone = new Set(dismissed.map(tag));
  const shown = drafts.filter((d) => !gone.has(tag(d)));
  const pointed = new Set(shown.flatMap((d) => d.from.map(tag)));
  const candidates = shown.filter((d) => !pointed.has(tag(d)));
  return { candidates, hidden: drafts.filter((d) => !candidates.includes(d)) };
}

function isExpired(draft: DraftBackup, now: number): boolean {
  return now - draft.savedAt > DRAFT_MAX_AGE_MS;
}

/**
 * 這個狀態的稿件留不留底（審查 4；Codex 第二輪後主 session 裁定）：能改的恢復；其他一律先不動、**不刪**——
 * 發布中、已取消（可以恢復，D-031）、失敗（可以重試）等能改了再問；已發布、被取代再也不能改，只隱藏。都靠 30 天過期清
 * （讀取時唯一自動刪別人的是內容完全相同）。
 */
export function draftEligibility(state: JobState): 'restore' | 'wait' {
  if (state === 'PUBLISHING' || state === 'CANCELLED' || state === 'FAILED' || state === 'PUBLISHED' || state === 'SUPERSEDED') {
    return 'wait';
  }
  return 'restore';
}

/**
 * 什麼時候可以拿留底跟校樣比（審查 1）：不在打字模式、沒有 hold，而且 iframe **確定載入的就是目前這一版**
 * （載入時記下的 key 等於目前的版本）。編輯中版本被換掉的那一刻，iframe 裡還是使用者剛打的字，不能拿它比。
 */
export function draftCheckReady(input: {
  readonly enabled: boolean;
  readonly isEditing: boolean;
  readonly holding: boolean;
  readonly hasRevision: boolean;
  readonly loadedKey: string | null;
  readonly revisionKey: string;
}): boolean {
  return input.enabled && !input.isEditing && !input.holding && input.hasRevision && input.loadedKey === input.revisionKey;
}

export type DraftPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'drop' }
  | { readonly kind: 'auto' }
  | { readonly kind: 'offer'; readonly changedSince: boolean };

export type DraftAction = Extract<DraftPlan, { kind: 'auto' } | { kind: 'offer' }>;

/**
 * 一份留底要怎麼辦：
 * - 過期：刪掉。稿件現在不能改（發布中、已取消、失敗、已發布、被取代）：先不動，不刪。
 * - 跟畫面上這一版照「儲存」同一套整理比（`differs`）完全相同：默默刪（不少任何字）。
 * - 基準 hash 不是目前版本（之後有別的存檔、AI 套用、換模板）：只問「恢復」「捨棄」，不自動蓋掉（審查 1）。
 * - 基準是目前版本：現在可以進打字模式→直接進打字模式填回（`auto`）；AI 在跑之類不能進→先問。
 * `differs` 要動到校樣文件，只在需要時才呼叫。
 */
export function planDraftRestore(input: {
  readonly draft: DraftBackup | null;
  readonly now: number;
  readonly state: JobState;
  readonly currentHash: string | undefined;
  readonly canEdit: boolean;
  readonly differs: () => boolean;
}): DraftPlan {
  const { draft } = input;
  if (draft === null) return { kind: 'none' };
  if (isExpired(draft, input.now)) return { kind: 'drop' };
  if (draftEligibility(input.state) === 'wait') return { kind: 'none' };
  // 內容跟目前存好的完全相同（照「儲存」同一套整理比）：刪了不少任何字（Codex 第二輪：讀取時唯一可以自動刪的情況之一）。
  // 比對只在 iframe 確定載入目前這一版時才做（`draftCheckReady`，審查 1）。
  if (!input.differs()) return { kind: 'drop' };
  const sameBase = input.currentHash !== undefined && draft.baseHash === input.currentHash;
  if (!sameBase) return { kind: 'offer', changedSince: true };
  return input.canEdit ? { kind: 'auto' } : { kind: 'offer', changedSince: false };
}

/**
 * 同一篇有好幾份留底（新的在前）：一份一份看，要刪的刪掉、繼續看下一份；第一份要恢復或要問的就停在它
 * （一次只處理一份，處理完再看下一份）。發布中之類先不動的，整篇都先不動。
 */
export function pickDraftPlan(
  drafts: readonly DraftBackup[],
  plan: (draft: DraftBackup) => DraftPlan,
): { drop: DraftBackup[]; pick: { draft: DraftBackup; plan: DraftAction } | null } {
  const drop: DraftBackup[] = [];
  for (const draft of drafts) {
    const decided = plan(draft);
    if (decided.kind === 'drop') {
      drop.push(draft);
      continue;
    }
    if (decided.kind === 'none') return { drop, pick: null };
    return { drop, pick: { draft, plan: decided } };
  }
  return { drop, pick: null };
}

/**
 * 打開一篇稿件（校樣確定是目前這一版）時整篇留底怎麼處理（Codex 第二、三輪）。讀取時**唯一**會自動刪別人的：
 * 跟目前存好的版本內容完全相同（`differs` 回 false），以及過期 30 天。其餘一律只隱藏不刪：已捨棄的、被副本指著的來源（`visibleDrafts`）、
 * 跟另一份留底內容相同的舊的那份（`contentKey` 一樣）。再從新的開始一次處理一份（`pickDraftPlan`）。
 */
export function planDraftLoad(input: {
  /** 這篇的所有留底，新的在前。 */
  readonly drafts: readonly DraftBackup[];
  readonly dismissed: readonly DraftOrigin[];
  readonly now: number;
  readonly state: JobState;
  readonly currentHash: string | undefined;
  readonly canEdit: boolean;
  readonly differs: (draft: DraftBackup) => boolean;
  /** 標題＋正規化後內文；一樣＝內容完全相同。 */
  readonly contentKey: (draft: DraftBackup) => string;
}): { remove: DraftBackup[]; pick: { draft: DraftBackup; plan: DraftAction } | null } {
  const { candidates } = visibleDrafts(input.drafts, input.dismissed);
  // 留底之間內容相同：只在候選裡隱藏舊的那份（留新的），**不刪**（Codex 第三輪：刪了之後新的那份被別的分頁取消，字就沒了）。
  const seen = new Set<string>();
  const unique = candidates.filter((draft) => {
    const key = input.contentKey(draft);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const { drop, pick } = pickDraftPlan(unique, (draft) =>
    planDraftRestore({
      draft,
      now: input.now,
      state: input.state,
      currentHash: input.currentHash,
      canEdit: input.canEdit,
      differs: () => input.differs(draft),
    }),
  );
  return { remove: drop, pick };
}

/**
 * 「恢復」按不按得下去（審查 2）：不在打字模式要能進打字模式；在打字模式中**這次已經打過字**就不准（會把剛打的整個換掉），
 * 要先儲存或取消。
 */
export function restoreAllowed(input: {
  readonly isEditing: boolean;
  readonly canEdit: boolean;
  readonly typedThisSession: boolean;
  readonly blockedNote: string;
}): { readonly allowed: boolean; readonly reason: string | null } {
  if (input.isEditing) {
    return input.typedThisSession ? { allowed: false, reason: DRAFT_RESTORE_WHILE_TYPING_NOTE } : { allowed: true, reason: null };
  }
  return input.canEdit ? { allowed: true, reason: null } : { allowed: false, reason: input.blockedNote };
}

/**
 * 存檔成功之後留底怎麼辦（審查 5）：送出之後到回應之間又打了字（現在的跟送出那一刻不一樣）就留著、基準換成存好的那一版，
 * 重載後照恢復規則把多打的字找回來；沒再打字才刪。`now` 是 null＝讀不到現在的內容（例如已經換篇），照儲存區那份比。
 */
export function afterSaveDraft(input: {
  readonly sent: { readonly title: string | null; readonly body: string };
  readonly now: { readonly title: string | null; readonly body: string } | null;
}): 'remove' | 'keep' {
  if (input.now === null) return 'remove';
  return input.now.body === input.sent.body && input.now.title === input.sent.title ? 'remove' : 'keep';
}

/** 填回時整理拿掉的格式要講出來（審查 6）。 */
export function restoreDroppedNote(dropped: readonly string[]): string {
  return `恢復的內容裡有這個版型不支援的格式：${dropped.join('、')}。已經拿掉，字留著。`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 提示列上的時間：同一天 HH:MM，不同天加上「月/日」。 */
export function draftTimeLabel(savedAt: number, now: number): string {
  const at = new Date(savedAt);
  const today = new Date(now);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
  return sameDay ? time : `${at.getMonth() + 1}/${at.getDate()} ${time}`;
}

export type DraftNotice =
  | { readonly kind: 'restored'; readonly savedAt: number }
  | { readonly kind: 'offer'; readonly changedSince: boolean; readonly savedAt: number };

export function draftNoticeText(notice: DraftNotice, now: number): string {
  const at = draftTimeLabel(notice.savedAt, now);
  if (notice.kind === 'restored') return `已恢復 ${at} 沒存的內容，還沒儲存。`;
  return notice.changedSince ? `有 ${at} 沒存的內容，但這篇之後又改過。` : `有 ${at} 沒存的內容還沒恢復。`;
}

// ---------------------------------------------------------------------------
// 填回之前的整理
// ---------------------------------------------------------------------------

/** 屬性值是不是 `javascript:` 之類會執行的網址（先拿掉瀏覽器會忽略的控制字元與空白）。 */
function isScriptUrl(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000- \u007f]/g, '').toLowerCase();
  return flat.startsWith('javascript:') || flat.startsWith('vbscript:');
}

const URL_ATTRS = new Set(['src', 'href', 'srcset', 'action', 'formaction', 'xlink:href', 'poster', 'background']);

function stripUnsafe(nodes: readonly RichNode[]): RichNode[] {
  return nodes.map((node) => {
    if (node.type === 'text') return node;
    return {
      type: 'element',
      tag: node.tag,
      attrs: node.attrs.filter((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') return false;
        return !(URL_ATTRS.has(name) && isScriptUrl(attr.value));
      }),
      children: stripUnsafe(node.children),
    };
  });
}

/**
 * 留底的內文填回編輯區之前（不直接塞 innerHTML）：先照存檔的同一套共用規則整理（`cleanRichEdit`：模板 allowlist、
 * 連結網址規則、b／i 換 strong／em、script 連內容丟掉），跟目前版本一樣的區塊原樣保留；改過的區塊再拿掉事件屬性與
 * `javascript:` 網址。不用貼上的模式：貼上會丟掉圖片與 `wp-block-*` class，恢復一篇有圖的文章會把圖弄不見。
 * 這不是安全關卡（校樣 iframe 不跑 script；存檔時後端照樣整理、sanitize）。
 */
export function safeRestoredEdit(result: RichEditResult): RichEditResult {
  return {
    dropped: result.dropped,
    pieces: result.pieces.map((piece) => (piece.kept ? piece : { kept: false, nodes: stripUnsafe(piece.nodes) })),
  };
}

/**
 * 打開儲存區（審查 8）：拿不到（被擋）→ null；拿得到但寫不進去（滿了、無痕）→ 照樣讀得到、刪得掉，只標記不能寫。
 */
export function openDraftStorage(get: () => DraftStorage): { storage: DraftStorage | null; writable: boolean } {
  let storage: DraftStorage;
  try {
    storage = get();
  } catch {
    return { storage: null, writable: false };
  }
  try {
    const probe = `${DRAFT_KEY_PREFIX}__probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return { storage, writable: true };
  } catch {
    return { storage, writable: false };
  }
}

export function browserDraftStorage(): { storage: DraftStorage | null; writable: boolean } {
  return openDraftStorage(() => window.localStorage);
}
