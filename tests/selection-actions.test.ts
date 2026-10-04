import { describe, expect, it } from 'vitest';

import {
  capsuleLeft,
  capsuleView,
  imagePanelLeft,
  pickSelection,
  type PickedSelection,
} from '../src/ui/lib/selection-actions.js';
import { FACTCHECK_SELECTION_MAX } from '../src/contract/factcheck.js';
import { SELECTION_IMAGE_MIN } from '../src/contract/selection-image.js';
import { selectionProblem } from '../src/ui/lib/factcheck-view.js';

/** 選字之後的膠囊（查證這句、用此段配圖；P5-T041 從 ProofView 抽出）。 */

const sentence = '一個制度要活下來，靠的不是設計得多精巧。';
const body = (text: string, inTitle = false): PickedSelection => ({ text, top: 120, left: 300, inTitle });
const check = { blockedReason: null, note: null };
const image = { blockedReason: null };

describe('膠囊上的按鈕', () => {
  it('選一句、兩邊都給：兩顆都能按，沒有說明', () => {
    expect(capsuleView(body(sentence), check, image)).toEqual({
      checkProblem: null,
      imageShown: true,
      imageProblem: null,
      notes: [],
    });
  });

  it('只選到標題：沒有「用此段配圖」，它的原因也不講', () => {
    const view = capsuleView(body('看得見的錯誤才是便宜的錯誤', true), check, { blockedReason: 'Codex 不能用' });
    expect(view.imageShown).toBe(false);
    expect(view.imageProblem).toBeNull();
    expect(view.notes).toEqual([]);
  });

  it('上層沒給「用此段配圖」：只有查證', () => {
    const view = capsuleView(body(sentence), check, null);
    expect(view.imageShown).toBe(false);
    expect(view.imageProblem).toBeNull();
  });

  it('選超過查證上限：查證反灰講字數，配圖照樣能按', () => {
    const long = '字'.repeat(FACTCHECK_SELECTION_MAX + 1);
    const view = capsuleView(body(long), check, image);
    expect(view.checkProblem).toBe(selectionProblem(long));
    expect(view.checkProblem).not.toBeNull();
    expect(view.imageProblem).toBeNull();
    expect(view.notes).toEqual([{ text: view.checkProblem, tone: 'warn' }]);
  });

  it('上層擋住查證時先講上層的原因，不看字數', () => {
    const long = '字'.repeat(FACTCHECK_SELECTION_MAX + 1);
    const view = capsuleView(body(long), { blockedReason: '另一個 AI 動作在跑', note: null }, image);
    expect(view.checkProblem).toBe('另一個 AI 動作在跑');
  });

  it('配圖字數太短：配圖反灰講原因', () => {
    const short = '字'.repeat(SELECTION_IMAGE_MIN - 1);
    const view = capsuleView(body(short), check, image);
    expect(view.checkProblem).toBeNull();
    expect(view.imageProblem).not.toBeNull();
    expect(view.notes).toEqual([{ text: view.imageProblem, tone: 'warn' }]);
  });

  it('兩顆都能按：講查證那家的提醒', () => {
    const view = capsuleView(body(sentence), { blockedReason: null, note: '會用掉 Claude 額度' }, image);
    expect(view.notes).toEqual([{ text: '會用掉 Claude 額度', tone: 'info' }]);
  });

  it('兩顆被同一個原因擋住只講一次', () => {
    const reason = '另一個 Agent 動作還在跑';
    const view = capsuleView(body(sentence), { blockedReason: reason, note: null }, { blockedReason: reason });
    expect(view.notes).toEqual([{ text: reason, tone: 'warn' }]);
  });
});

describe('膠囊與面板的位置', () => {
  it('選取靠左時不讓膠囊被切掉；有配圖那顆時留得更寬', () => {
    expect(capsuleLeft(20, false)).toBe(80);
    expect(capsuleLeft(20, true)).toBe(150);
    expect(capsuleLeft(400, true)).toBe(400);
  });

  it('面板一樣不被切掉', () => {
    expect(imagePanelLeft(100)).toBe(220);
    expect(imagePanelLeft(500)).toBe(500);
  });
});

/** 只做 pickSelection 會碰到的那幾個介面（node 環境沒有 DOM）。 */
function fakeDoc(input: {
  text: string;
  collapsed?: boolean;
  /** 選取所在的位置：`body`、`title`、`outside`。 */
  where: 'body' | 'title' | 'outside';
  textNode?: boolean;
  rects?: { bottom: number; left: number; width: number }[];
  scrollY?: number;
}): Document {
  const element = {
    nodeType: 1,
    closest: (selector: string) => {
      if (input.where === 'outside') return null;
      if (selector === '.preview-title') return input.where === 'title' ? element : null;
      return element;
    },
  };
  const container = input.textNode === false ? element : { nodeType: 3, parentElement: element };
  const rects = input.rects ?? [];
  const range = {
    commonAncestorContainer: container,
    getClientRects: () => rects,
    getBoundingClientRect: () => ({ bottom: 50, left: 10, width: 100 }),
  };
  const selection = {
    isCollapsed: input.collapsed ?? false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => input.text,
  };
  return { getSelection: () => selection, defaultView: { scrollY: input.scrollY ?? 0 } } as unknown as Document;
}

describe('選了什麼（pickSelection）', () => {
  it('在正文選字：膠囊在最後一行下方 6px 的中間（文件座標）', () => {
    const doc = fakeDoc({
      text: sentence,
      where: 'body',
      rects: [
        { bottom: 100, left: 0, width: 500 },
        { bottom: 130, left: 200, width: 80 },
      ],
      scrollY: 40,
    });
    expect(pickSelection(doc)).toEqual({ text: sentence, top: 176, left: 240, inTitle: false });
  });

  it('沒有逐行的框時用整個範圍的框', () => {
    expect(pickSelection(fakeDoc({ text: sentence, where: 'body' }))).toEqual({
      text: sentence,
      top: 56,
      left: 60,
      inTitle: false,
    });
  });

  it('選取的共同祖先是元素本身也算', () => {
    expect(pickSelection(fakeDoc({ text: sentence, where: 'body', textNode: false }))?.text).toBe(sentence);
  });

  it('在標題選字：標成 inTitle', () => {
    expect(pickSelection(fakeDoc({ text: '看得見', where: 'title' }))?.inTitle).toBe(true);
  });

  it('沒選、只選到空白、跨出正文與標題的都不算', () => {
    expect(pickSelection(fakeDoc({ text: sentence, where: 'body', collapsed: true }))).toBeNull();
    expect(pickSelection(fakeDoc({ text: '  \n ', where: 'body' }))).toBeNull();
    expect(pickSelection(fakeDoc({ text: sentence, where: 'outside' }))).toBeNull();
    expect(pickSelection({ getSelection: () => null } as unknown as Document)).toBeNull();
  });
});
