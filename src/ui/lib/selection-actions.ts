import { selectionProblem } from './factcheck-view.js';
import { capsuleNotes, selectionImageProblem } from './selection-image-view.js';

/**
 * 選字之後浮出的膠囊（查證這句、用此段配圖；P6-T005、P5-T038）不需要 React 的部分（P5-T041 從 ProofView 抽出）。
 * 狀態與按下去之後的流程在 `components/SelectionActions.tsx` 的 `useSelectionActions`。
 */

/** 選了哪段字、膠囊畫在哪（文件座標）、是不是只選到標題。 */
export interface PickedSelection {
  readonly text: string;
  readonly top: number;
  readonly left: number;
  readonly inTitle: boolean;
}

/**
 * 選字查證：目前的選取（不收空的、不收跨出正文與標題的），以及膠囊要畫在哪（選取最後一行的下方中間，文件座標）。
 * 選的字只拿純文字（`toString()`）。
 */
export function pickSelection(doc: Document): PickedSelection | null {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === 1 ? (container as Element) : container.parentElement;
  if (!element || typeof element.closest !== 'function' || element.closest('.preview-body, .preview-title') === null) return null;
  const text = selection.toString();
  if (text.trim().length === 0) return null;
  const rects = range.getClientRects();
  const last = rects.length > 0 ? rects[rects.length - 1]! : range.getBoundingClientRect();
  const scrollY = doc.defaultView?.scrollY ?? 0;
  return {
    text,
    top: last.bottom + scrollY + 6,
    left: last.left + last.width / 2,
    inTitle: element.closest('.preview-title') !== null,
  };
}

/** 膠囊上兩顆按鈕各自能不能按、底下講什麼。 */
export interface CapsuleView {
  /** 「查證這句」不能按的原因；null＝可以。 */
  readonly checkProblem: string | null;
  /** 有沒有「用此段配圖」這顆（上層有給、而且不是只選到標題）。 */
  readonly imageShown: boolean;
  /** 「用此段配圖」不能按的原因；null＝可以（或沒有這顆）。 */
  readonly imageProblem: string | null;
  readonly notes: { text: string; tone: 'warn' | 'info' }[];
}

/**
 * 選了這段之後膠囊長什麼樣：查證先看上層擋住的原因、再看字數；「用此段配圖」只選到標題的不給（P5-T038）。
 */
export function capsuleView(
  picked: PickedSelection,
  check: { readonly blockedReason: string | null; readonly note: string | null } | null,
  image: { readonly blockedReason: string | null } | null,
): CapsuleView {
  const checkProblem = check?.blockedReason ?? selectionProblem(picked.text);
  const checkNote = check?.note ?? null;
  const imageShown = image !== null && !picked.inTitle;
  const imageProblem = !imageShown ? null : selectionImageProblem(picked.text, image.blockedReason);
  return { checkProblem, imageShown, imageProblem, notes: capsuleNotes({ checkProblem, imageProblem, imageShown, checkNote }) };
}

/** 膠囊的水平位置：選取靠左邊時不讓它被切掉（兩顆按鈕比較寬）。 */
export function capsuleLeft(left: number, imageShown: boolean): number {
  return Math.max(left, imageShown ? 150 : 80);
}

/** 「用此段配圖」面板的水平位置：一樣不讓它被切掉。 */
export function imagePanelLeft(left: number): number {
  return Math.max(left, 220);
}
