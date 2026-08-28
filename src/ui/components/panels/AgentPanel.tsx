import { useState, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { AgentProvider, LoadedJob } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { formatRelative } from '../../lib/format.js';
import { ErrorNote, Field, Spinner, useAction } from './shared.js';

/**
 * 校稿。
 *
 * 這個框裡打的字會變成 Agent 的 prompt，Agent 回的是 **templateData（JSON）**，
 * HTML 一律由渲染器產生（契約 §一.1）。所以這裡沒有任何「編輯 HTML」的入口，
 * 也不會把 Agent 的輸出直接貼到畫面上。
 *
 * 同時只能跑一個（concurrency 1），跑的時候要能取消。
 */

const PROVIDERS: { id: AgentProvider; label: string }[] = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'google', label: 'Gemini' },
];

const PRESETS = [
  '校對錯字與標點，語意不要改。',
  '把過長的段落拆開，每段一個重點。',
  '統一全形標點，並把口語的贅字拿掉。',
];

export function AgentPanel({
  job,
  refresh,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [provider, setProvider] = useState<AgentProvider>('claude');
  const [instruction, setInstruction] = useState('');
  const send = useAction();
  const cancel = useAction();

  const running = job.agentRun?.status === 'running';

  if (running) {
    return (
      <div className="stack">
        <p className="agent-running" role="status">
          <Spinner />
          <span>
            {job.agentRun?.provider} 正在校稿…（{formatRelative(job.agentRun?.startedAt)}開始）
          </span>
        </p>
        <p className="field-hint">
          校稿期間 Agent 沒有 shell、檔案寫入、網路與 WordPress 權限，只會回傳結構化資料。
        </p>
        <ErrorNote message={cancel.error} />
        <div className="row row-end">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={cancel.busy}
            onClick={() =>
              void cancel.run(async () => {
                await api.cancelAgent(job.uuid);
                await refresh();
              })
            }
          >
            <Icon name="x" size={14} />
            停止
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <Field label="交給哪一個">
        <div className="segmented" role="radiogroup" aria-label="Agent">
          {PROVIDERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={provider === option.id}
              className="segmented-item"
              data-active={provider === option.id ? 'yes' : 'no'}
              onClick={() => setProvider(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="要它做什麼" hint="講具體的要求。Agent 只會回傳修改後的內容，不會碰版面。">
        <textarea
          className="input textarea"
          rows={4}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="例如：第二段太長，拆成兩段。"
        />
      </Field>

      <div className="chips">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="chip"
            onClick={() => setInstruction(preset)}
          >
            {preset}
          </button>
        ))}
      </div>

      {job.agentRun && job.agentRun.status !== 'succeeded' && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            上一次由 {job.agentRun.provider} 執行的校稿{statusText(job.agentRun.status)}。
            {job.agentRun.errorMessage ? `原因：${job.agentRun.errorMessage}` : ''}
          </span>
        </p>
      )}

      <ErrorNote message={send.error} />

      <div className="row row-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={send.busy || instruction.trim().length === 0 || job.currentRevision === null}
          onClick={() =>
            void send.run(async () => {
              await api.runAgent(job.uuid, { provider, instruction: instruction.trim() });
              setInstruction('');
              await refresh();
            })
          }
        >
          {send.busy ? <Spinner /> : <Icon name="sparkles" size={14} />}
          交給 Agent
        </button>
      </div>
    </div>
  );
}

function statusText(status: string): string {
  switch (status) {
    case 'failed':
      return '失敗了';
    case 'cancelled':
      return '被停止了';
    case 'timeout':
      return '逾時了';
    default:
      return `結束於 ${status}`;
  }
}
