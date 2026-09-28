import type { CreateJobRequest } from '../../contract/api.js';
import { isBlankBody } from '../../contract/empty-body.js';
import { checkPlainTitle, flattenTitleText } from '../../contract/plain-title.js';

/**
 * 新稿件直接在文章上寫、標題在文章上直接改（D-030，P5-T029）。畫面的判斷放這裡，才測得到。
 */

/**
 * 新稿件畫面送出的建稿請求。
 *
 * - 從「新長文／新日記」按鈕進來：只有類型與標題，原稿是空的，建好直接進打字模式。
 * - 從總覽拖放檔案或 ⌘V 貼上進來：帶著原稿建立（照舊轉成段落），不進打字模式——內容已經在了。
 */
export function newJobRequest(input: {
  targetKey: string;
  title: string;
  initialText?: string | undefined;
}): { request: CreateJobRequest; editOnOpen: boolean } {
  const title = input.title.trim();
  const text = input.initialText ?? '';
  const pasted = text.trim().length > 0;
  return {
    request: { targetKey: input.targetKey, sourceText: pasted ? text : '', ...(title === '' ? {} : { title }) },
    editOnOpen: !pasted,
  };
}

export type ProofSaveDecision =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'confirm-drop'; readonly dropped: readonly string[] }
  | { readonly kind: 'invalid-title'; readonly message: string }
  | { readonly kind: 'save'; readonly editedBody?: string; readonly editedTitle?: string };

/**
 * 打字模式按「儲存」要送什麼。
 *
 * 正文：整理過的跟進入編輯時整理過的一樣就不算改（兩邊都是空的也算一樣：空文章的空段落整理前後長得不同）。
 * 標題：讀的是標題元素的 textContent（格式與 HTML 拿不到），換行攤平；空的不准存。
 * 有改的才送；兩個都沒改就不建新版本。
 */
export function decideProofSave(input: {
  readonly bodyCleaned: string;
  readonly bodyOriginal: string;
  readonly dropped: readonly string[];
  readonly force: boolean;
  /** null＝這一版沒有標題元素可以改（例如校樣讀不到），只看正文。 */
  readonly titleText: string | null;
  readonly titleOriginal: string;
  readonly diary: boolean;
}): ProofSaveDecision {
  const bodyChanged =
    input.bodyCleaned !== input.bodyOriginal && !(isBlankBody(input.bodyCleaned) && isBlankBody(input.bodyOriginal));

  let editedTitle: string | undefined;
  if (input.titleText !== null) {
    const flat = flattenTitleText(input.titleText);
    if (flat.trim() !== input.titleOriginal.trim()) {
      const checked = checkPlainTitle(flat, { diary: input.diary });
      if (!checked.ok) return { kind: 'invalid-title', message: checked.message };
      editedTitle = checked.title;
    }
  }

  if (!bodyChanged && editedTitle === undefined) return { kind: 'unchanged' };
  if (bodyChanged && input.dropped.length > 0 && !input.force) return { kind: 'confirm-drop', dropped: input.dropped };
  return {
    kind: 'save',
    ...(bodyChanged ? { editedBody: input.bodyCleaned } : {}),
    ...(editedTitle === undefined ? {} : { editedTitle }),
  };
}
