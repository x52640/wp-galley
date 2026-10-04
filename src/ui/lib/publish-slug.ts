/**
 * 發布面板的「網址」列（D-038，P5-T039）：要講什麼、能不能建議、要不要直接攤開編輯。
 *
 * 網址（`templateData.slug`）會進 content hash（docs/specs/state-machine.md），所以改網址就是建一版新內容：
 * 核准作廢、稿子退回 RENDERED，要重新看成品、重新核准。這裡只決定**改之前**要不要先講。
 *
 * 這個檔不碰 React 與 API，可以直接在 node 裡測。
 */

export interface PublishSlugInput {
  readonly contentType: string;
  /** 已存的網址（templateData.slug），沒有就空字串。 */
  readonly slug: string;
  /** 已存的標題：空網址時 WordPress 拿它產生網址。 */
  readonly title: string;
  /** 目前有一張有效的核准（稿子是 APPROVED）。 */
  readonly approvedNow: boolean;
}

export interface PublishSlugView {
  /** 有填的網址；沒填是 null。 */
  readonly value: string | null;
  /** 沒填時要講的後果。warn＝醒目提醒（不擋發布）；plain＝照實說明（日記）。 */
  readonly empty: { readonly tone: 'warn' | 'plain'; readonly text: string } | null;
  /** 給不給「建議網址」（D-026：日記不用，網址是日期）。 */
  readonly canSuggest: boolean;
  /** 一打開面板就攤開編輯列（空的、而且能建議的那種：當場就能填）。 */
  readonly openEditor: boolean;
  /** 改網址之前要先講的核准後果；沒有核准可丟時是 null。 */
  readonly approvalNote: string | null;
}

/** WordPress 只把英數留成可讀的網址；其他字（中文）會被百分比編碼成一長串。 */
const READABLE_TITLE = /^[\x20-\x7e]*$/;
/** 日記的標題慣例（docs/specs/wordpress-site.md）。 */
const DATE_TITLE = /^\d{8}$/;

export function publishSlugView(input: PublishSlugInput): PublishSlugView {
  const isDiary = input.contentType === 'diary';
  const slug = input.slug.trim();
  const title = input.title.trim();
  const approvalNote = input.approvedNow
    ? '改網址等於換一版內容：現在的核准會作廢，存了之後要重新看成品、重新核准。'
    : null;

  if (slug !== '') {
    return { value: slug, empty: null, canSuggest: !isDiary, openEditor: false, approvalNote };
  }

  if (isDiary && DATE_TITLE.test(title)) {
    const text = `沒填網址：WordPress 會用標題產生，日記的標題是日期，網址就會是「${title}」。`;
    return { value: null, empty: { tone: 'plain', text }, canSuggest: false, openEditor: false, approvalNote };
  }

  const readable = READABLE_TITLE.test(title);
  const text = readable
    ? '沒填網址：WordPress 會用標題自動產生。'
    : '沒填網址：WordPress 會用標題自動產生，中文標題會變成一長串編碼（%E4%B8%AD…），發出去之後只能到後台改。';
  // 日記不建議（D-026），也不自動攤開編輯；標題全是英數時只是照實說明。
  if (isDiary) {
    return { value: null, empty: { tone: readable ? 'plain' : 'warn', text }, canSuggest: false, openEditor: false, approvalNote };
  }
  return { value: null, empty: { tone: 'warn', text }, canSuggest: true, openEditor: true, approvalNote };
}

/**
 * 發布面板存網址時送出的 templateData。templateData 是**整份取代**，其他欄位原樣帶上；
 * 清空就拿掉 `slug` 鍵讓 WordPress 自己產生（schema 不收空字串，P5-T021）。
 */
export function withSlug(
  data: Readonly<Record<string, unknown>> | null | undefined,
  slug: string,
): Record<string, unknown> {
  const { slug: _old, ...rest } = data ?? {};
  const next = slug.trim();
  return next === '' ? rest : { ...rest, slug: next };
}

/** 網址框跟已存的值不一樣（只差前後空白不算）。 */
export function isSlugDirty(draft: string, saved: string): boolean {
  return draft.trim() !== saved.trim();
}

/**
 * 網址框有沒存的改動、或正在存時擋發布（P5-T039 審查 #1、#4）。不做「按發布時順便存」：
 * 存網址會讓核准作廢、要重新看成品，不能在同一次點擊裡默默完成。
 */
export function slugPublishBlocker(input: { readonly dirty: boolean; readonly saving: boolean }): string | null {
  if (input.saving) return '正在存網址，存好、成品重新載入之後才能發布。';
  if (input.dirty) return '網址改了還沒存：按「存網址」，或按取消。';
  return null;
}

/**
 * 已存的網址換了（新版本）時，框裡該放什麼（審查 #2）：框裡沒改動（等於換之前已存的值）才跟上新值；
 * 有改動就留著使用者打的字，不默默清掉（例如同一個面板按了「儲存分類」）。
 */
export function nextSlugDraft(draft: string, prevSaved: string, nextSaved: string): string {
  return isSlugDirty(draft, prevSaved) ? draft : nextSaved;
}

/**
 * 在發布面板按 Escape 時網址列要做什麼（審查 #3）：有沒存的改動只還原框內的字、不關面板；
 * 按「改」打開而沒改動就收起編輯；其他照常關面板。
 */
export function slugEscapeAction(input: { readonly dirty: boolean; readonly editing: boolean }): 'revert' | 'close-editor' | 'close-sheet' {
  if (input.dirty) return 'revert';
  if (input.editing) return 'close-editor';
  return 'close-sheet';
}
