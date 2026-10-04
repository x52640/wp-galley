import { useId, useState, type JSX } from 'react';
import type { FactCheckFinding, FactCheckSource, FactCheckVerdict } from '../service/types.js';
import { Icon } from '../icons.js';
import {
  ORIGIN_LABEL,
  VERDICT_LABEL,
  downgradeNote,
  hostOf,
  quoteInContext,
  safeHref,
  sourceCheckText,
} from '../lib/factcheck-view.js';
import { FcIcon, type FactcheckIconName } from './FactcheckIcon.js';

/**
 * 右欄的查證卡片（P6-T005，docs/specs/factcheck.md「觸發與畫面」）。
 *
 * 跟校稿卡片混排、一樣一對一對應文章上的標記，但它**不是改動**：沒有「接受」，`correction` 只是一行文字
 * （永不自動套用）。判定用文字＋圖示，不只靠顏色。抓回來的字（evidence、quote、context）一律當文字節點放。
 */

const VERDICT_ICON: Record<FactCheckVerdict, FactcheckIconName> = {
  supported: 'check-circle',
  contradicted: 'circle-alert',
  unverifiable: 'circle-help',
  'needs-context': 'info',
};

export function FactcheckCard({
  finding,
  active,
  busy,
  onActivate,
  onJump,
  onEdit,
  onDismiss,
}: {
  finding: FactCheckFinding;
  active: boolean;
  busy: boolean;
  /** 點卡片上的那句：亮起來、文章捲過去；再點一次取消。 */
  onActivate: () => void;
  /** 「跳到該段」：一定亮起來、捲過去。 */
  onJump: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const verdict = finding.verdict;
  const downgrade = downgradeNote(finding);
  const key = `f${finding.id}`;

  return (
    <article className="s-card fc-card" data-kind="factcheck" data-verdict={verdict} data-active={active ? 'yes' : 'no'} data-item={key}>
      <header className="s-card-head">
        <span className="fc-verdict" data-verdict={verdict}>
          <FcIcon name={VERDICT_ICON[verdict]} size={15} />
          {VERDICT_LABEL[verdict]}
        </span>
        <span className="fc-tag">
          <FcIcon name="search-check" size={12} />
          查證
        </span>
        {finding.blockIndex !== null && <span className="s-where">第 {finding.blockIndex + 1} 段</span>}
      </header>

      <button type="button" className="s-jump s-body" onClick={onActivate} aria-pressed={active}>
        <span className="s-quote">「{finding.excerpt}」</span>
      </button>

      {finding.claim.replace(/\s+/gu, '') !== finding.excerpt.replace(/\s+/gu, '') && (
        <p className="fc-claim">查的是：{finding.claim}</p>
      )}
      <p className="s-reason fc-evidence">{finding.evidence}</p>
      {finding.correction !== null && (
        <p className="s-suggest">
          建議：{finding.correction}
          <span className="fc-dim">（只是建議，要改請按「去原文改」）</span>
        </p>
      )}
      {downgrade !== null && (
        <p className="fc-downgrade">
          <Icon name="alert" size={13} />
          <span>{downgrade}</span>
        </p>
      )}

      {finding.sources.length > 0 ? (
        <div className="fc-sources">
          <p className="fc-sources-label">來源</p>
          <ul>
            {finding.sources.map((source, index) => (
              <SourceRow key={`${source.url}-${index}`} source={source} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="fc-dim">這條沒有可以看的來源。</p>
      )}

      <div className="s-actions">
        {finding.blockIndex !== null && (
          <button type="button" className="btn btn-quiet btn-tiny" onClick={onJump}>
            跳到該段
          </button>
        )}
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          title="在文章上直接改這句；存檔後這張卡片收進已處理"
          onClick={onEdit}
        >
          去原文改
        </button>
        <button type="button" className="btn btn-quiet btn-tiny" disabled={busy} onClick={onDismiss}>
          知道了
        </button>
      </div>
    </article>
  );
}

const CHECK_ICON: Record<string, FactcheckIconName> = {
  good: 'check',
  warn: 'alert',
  dim: 'minus',
};

function SourceRow({ source }: { source: FactCheckSource }): JSX.Element {
  const [open, setOpen] = useState(false);
  const contextId = useId();
  const href = safeHref(source.url);
  const check = sourceCheckText(source);
  const parts = source.context === null ? null : quoteInContext(source.context, source.quote);

  return (
    <li className="fc-source" data-check={source.check}>
      <div className="fc-source-main">
        {href !== null ? (
          <a className="fc-source-title" href={href} target="_blank" rel="noreferrer noopener">
            {source.title}
            <Icon name="external-link" size={11} />
            <span className="sr-only">（在新分頁打開）</span>
          </a>
        ) : (
          <span className="fc-source-title">{source.title}</span>
        )}
        <span className="fc-source-meta">
          {hostOf(source.url)} · {ORIGIN_LABEL[source.origin]}
        </span>
      </div>
      <div className="fc-source-row">
        <span className="fc-check" data-tone={check.tone}>
          <FcIcon name={CHECK_ICON[check.tone] ?? 'minus'} size={12} />
          {check.text}
        </span>
        {source.context !== null && (
          <button
            type="button"
            className="btn btn-quiet btn-tiny fc-open"
            aria-expanded={open}
            aria-controls={contextId}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
            {open ? '收起原文' : '看原文'}
          </button>
        )}
      </div>
      {source.check === 'not-found' && source.quote !== null && (
        <p className="fc-quote-missing">AI 引的話：「{source.quote}」</p>
      )}
      {open && source.context !== null && (
        <blockquote className="fc-context" id={contextId}>
          {parts === null ? (
            source.context
          ) : (
            <>
              {parts.before}
              <mark>{parts.quote}</mark>
              {parts.after}
            </>
          )}
        </blockquote>
      )}
    </li>
  );
}
