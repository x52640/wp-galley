import { cleanEditedBody, cleanRestoredBody, snapshotBody, type RichAllow } from './rich-commands.js';
import { decideEditSave } from './proof-editing.js';
import { unwrapHighlightMarks } from './proof-edit-dom.js';
import type { DraftBackup } from './draft-backup.js';

/**
 * 留底（D-047，P5-T048）要碰校樣文件的部分：打開一篇稿件、還沒進打字模式時，留底跟畫面上這一版一不一樣。
 * 照「儲存」同一套整理與比對（`cleanEditedBody`＋`decideEditSave`），所以「一樣」＝按儲存也不會建新版本。
 * 不動畫面：拿正文的複本拆掉字上的建議標記再比。
 */
export function draftDiffersFromShown(input: {
  readonly doc: Document;
  readonly draft: Pick<DraftBackup, 'title' | 'body'>;
  readonly allow: RichAllow;
  readonly savedTitle: string;
  readonly diary: boolean;
  readonly titleMaxLength: number | null;
}): boolean {
  const body = input.doc.querySelector('.preview-body');
  // 讀不到正文：比不了，當成不一樣（問使用者，不默默刪）。
  if (body === null) return true;
  const shown = body.cloneNode(true) as Element;
  unwrapHighlightMarks(shown);
  const units = snapshotBody(shown);
  const shownClean = cleanEditedBody(shown, input.allow, units).html;
  const titleText = input.doc.querySelector('.preview-title')?.textContent ?? null;
  const restored = cleanRestoredBody(input.draft.body, input.allow, units);
  const decision = decideEditSave({
    html: restored.html,
    dropped: restored.dropped,
    force: false,
    originalClean: shownClean,
    originalBody: shown.innerHTML,
    titleText: titleText === null ? null : (input.draft.title ?? titleText),
    originalTitle: titleText,
    savedTitle: input.savedTitle,
    diary: input.diary,
    titleMaxLength: input.titleMaxLength,
  });
  return decision.kind !== 'unchanged';
}

/**
 * 留底的「內容」（Codex 第二輪）：標題（空白攤平）＋照目前這一版整理後的內文。兩份一樣＝內容完全相同，舊的那份只在提示候選裡隱藏（不刪，Codex 第三輪）。
 * 整理用同一份目前版本的區塊，所以只差在編輯器雜訊（屬性、空白排版）的兩份會得到一樣的結果。
 */
export function draftContentKey(input: {
  readonly doc: Document;
  readonly draft: Pick<DraftBackup, 'title' | 'body'>;
  readonly allow: RichAllow;
}): string {
  const body = input.doc.querySelector('.preview-body');
  const shown = body === null ? null : (body.cloneNode(true) as Element);
  if (shown !== null) unwrapHighlightMarks(shown);
  const units = shown === null ? null : snapshotBody(shown);
  const title = (input.draft.title ?? '').replace(/\s+/g, ' ').trim();
  return `${title}\u0000${cleanRestoredBody(input.draft.body, input.allow, units).html}`;
}
