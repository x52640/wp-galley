import type { JSX } from 'react';
import type { ProofMark } from '../service/types.js';
import { groupMarks, type BlockBox } from '../lib/proof-frame.js';

/**
 * 校樣左側的校對符號（頁邊標記；P5-T043 從 ProofView 抽出）。
 *
 * 跟上一版比改了哪裡（新增、刪除、改寫、調動），每一段一顆或幾顆，對齊量到的段落頂端；
 * 滑鼠移過去或 Tab 走到就出現說明，點一下釘住。畫在 iframe 外層，iframe 裡什麼都不加。
 */

const KIND_LABEL: Record<ProofMark['kind'], string> = {
  inserted: '新增',
  deleted: '刪除',
  replaced: '改寫',
  moved: '調動',
};

/** 整排頁邊符號。`marks` 給空陣列（成品、打字中）就是空的一欄。 */
export function MarkGutter({
  marks,
  blocks,
  pinned,
  onToggle,
}: {
  marks: ProofMark[];
  blocks: readonly BlockBox[];
  /** 釘住的那一顆（`段-種類-第幾顆`）；null＝沒有。 */
  pinned: string | null;
  onToggle: (id: string) => void;
}): JSX.Element {
  return (
    <div className="proof-gutter" aria-label="校對符號">
      {groupMarks(marks).map(({ blockIndex, marks: list }) =>
        list.map((mark, order) => {
          const id = `${blockIndex}-${mark.kind}-${order}`;
          const top = blocks.find((block) => block.index === blockIndex)?.top;
          if (top === undefined) return null;
          return (
            <MarkPin
              key={id}
              id={id}
              mark={mark}
              top={top + order * 26}
              pinned={pinned === id}
              onToggle={() => onToggle(id)}
            />
          );
        }),
      )}
    </div>
  );
}

export function MarkPin({
  id,
  mark,
  top,
  pinned,
  onToggle,
}: {
  id: string;
  mark: ProofMark;
  top: number;
  pinned: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="mark" style={{ top: `${top}px` }} data-pinned={pinned ? 'yes' : 'no'}>
      <button
        type="button"
        className="mark-pin"
        aria-expanded={pinned}
        aria-controls={`mark-detail-${id}`}
        onClick={onToggle}
      >
        <span className="mark-glyph" aria-hidden="true">
          {mark.glyph}
        </span>
        <span className="sr-only">
          第 {mark.blockIndex + 1} 段{KIND_LABEL[mark.kind]}：{mark.summary}
        </span>
      </button>

      <div className="mark-pop" id={`mark-detail-${id}`} role="note">
        <p className="mark-pop-head">
          <span className="mark-pop-kind">{KIND_LABEL[mark.kind]}</span>
          <span className="mark-pop-where mono">第 {mark.blockIndex + 1} 段</span>
        </p>
        <p className="mark-pop-summary">{mark.summary}</p>
        {mark.before !== null && (
          <p className="mark-pop-line">
            <span className="mark-pop-tag">前</span>
            <span className="mark-pop-before">{mark.before}</span>
          </p>
        )}
        {mark.after !== null && (
          <p className="mark-pop-line">
            <span className="mark-pop-tag">後</span>
            <span className="mark-pop-after">{mark.after}</span>
          </p>
        )}
      </div>
    </div>
  );
}
