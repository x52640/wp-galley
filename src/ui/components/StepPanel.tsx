import { useEffect, useState, type JSX } from 'react';
import type { LoadedJob } from '../service/types.js';
import { Icon, type IconName } from '../icons.js';
import { readString, readStringArray } from '../lib/format.js';
import { STATE_LABEL, isTerminal, primaryPanel, type PanelKey } from '../lib/steps.js';
import { AgentPanel } from './panels/AgentPanel.js';
import { ApprovePanel } from './panels/ApprovePanel.js';
import { MediaPanel } from './panels/MediaPanel.js';
import { PublishPanel } from './panels/PublishPanel.js';
import { SourcePanel } from './panels/SourcePanel.js';
import { TaxonomyPanel } from './panels/TaxonomyPanel.js';
import { PanelCard } from './panels/shared.js';

/**
 * 右面板：只顯示「這一步該做的事」。
 *
 * 做法是：目前狀態對應的那張卡片自動攤開，其他卡片收起來但仍然點得開——
 * 想回頭改前面的東西不該被擋住，只是不該搶走注意力。
 */

interface CardSpec {
  key: PanelKey;
  icon: IconName;
  title: string;
  hint: (job: LoadedJob) => string | undefined;
}

const CARDS: CardSpec[] = [
  {
    key: 'source',
    icon: 'file-text',
    title: '原稿',
    hint: (job) => (job.currentRevision ? `r${job.currentRevision.number}` : '尚未輸入'),
  },
  {
    key: 'agent',
    icon: 'sparkles',
    title: '校稿',
    hint: (job) =>
      job.agentRun?.status === 'running'
        ? '執行中'
        : job.marks.length > 0
          ? `${job.marks.length} 處改動`
          : undefined,
  },
  {
    key: 'media',
    icon: 'image',
    title: '配圖',
    hint: (job) => {
      if (job.target.requireFeaturedImage && job.featuredMediaId === null) return '缺精選圖片';
      return job.media.length > 0 ? `${job.media.length} 張` : undefined;
    },
  },
  {
    key: 'taxonomy',
    icon: 'tag',
    title: '分類',
    hint: (job) => {
      if (job.target.taxonomy === null) return '不適用';
      const names =
        job.target.contentType === 'diary'
          ? [readString(job.currentRevision?.templateData, 'category')].filter((v) => v !== '')
          : readStringArray(job.currentRevision?.templateData, 'tags');
      return names.length > 0 ? names.join('、') : '未選';
    },
  },
  {
    key: 'approve',
    icon: 'stamp',
    title: '核准',
    hint: (job) => {
      if (!job.approval) return '未核准';
      return job.approval.valid ? '已核准' : '已失效';
    },
  },
  {
    key: 'publish',
    icon: 'send',
    title: '發布',
    hint: (job) =>
      job.published ? `#${job.published.wordpressId}` : job.blockers.length > 0 ? '尚未就緒' : undefined,
  },
];

export function StepPanel({
  job,
  refresh,
  blocks,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  blocks: { index: number; text: string }[];
}): JSX.Element {
  const primary = primaryPanel(job.state);
  const [open, setOpen] = useState<PanelKey | null>(primary);

  useEffect(() => setOpen(primary), [primary]);

  const currentTitle = CARDS.find((card) => card.key === primary)?.title ?? '完成';

  return (
    <aside className="panel" aria-label="這一步">
      <header className="panel-head">
        <p className="panel-eyebrow">這一步</p>
        <h2 className="panel-title">{currentTitle}</h2>
      </header>

      {isTerminal(job.state) && (
        <div className="terminal-card">
          <p className="terminal-state">
            <Icon name="alert" size={15} />
            {STATE_LABEL[job.state]}
          </p>
          {job.blockers.map((blocker) => (
            <p className="terminal-message" key={blocker}>
              {blocker}
            </p>
          ))}
        </div>
      )}

      <div className="cards">
        {CARDS.map((card) => (
          <PanelCard
            key={card.key}
            icon={card.icon}
            title={card.title}
            {...(card.hint(job) === undefined ? {} : { hint: card.hint(job) })}
            open={open === card.key}
            onToggle={() => setOpen((now) => (now === card.key ? null : card.key))}
          >
            {card.key === 'source' && <SourcePanel job={job} refresh={refresh} />}
            {card.key === 'agent' && <AgentPanel job={job} refresh={refresh} />}
            {card.key === 'media' && <MediaPanel job={job} refresh={refresh} blocks={blocks} />}
            {card.key === 'taxonomy' && <TaxonomyPanel job={job} refresh={refresh} />}
            {card.key === 'approve' && <ApprovePanel job={job} refresh={refresh} />}
            {card.key === 'publish' && <PublishPanel job={job} refresh={refresh} />}
          </PanelCard>
        ))}
      </div>
    </aside>
  );
}
