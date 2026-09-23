import { useState, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { AgentProvider, LoadedJob } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { AgentBusy } from '../AgentProgress.js';
import { ErrorNote, Field, Spinner, useAction } from './shared.js';

/**
 * 校稿。
 *
 * 這個框裡打的字會變成 Agent 的 prompt，Agent 回的是 **templateData（JSON）**，
 * HTML 一律由渲染器產生（契約 §一.1）。所以這裡沒有任何「編輯 HTML」的入口，
 * 也不會把 Agent 的輸出直接貼到畫面上。
 *
 * 同時只能跑一個（concurrency 1），跑的時候要能取消。
 *
 * **常做的事要一鍵。** 發文絕大多數是針對內容發的，校對只是順手做一次；每次都要
 * 先想一句話打進框裡才按得下去，等於把最常做的事變成最麻煩的事。所以「找錯字」
 * 與「找疑點」是兩顆直接送出的按鈕，打字那條路留給真的要交代事情的時候。
 */

const PROVIDERS: { id: AgentProvider; label: string }[] = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'google', label: 'Gemini' },
];

/**
 * 一鍵送出的兩件事，對應輸出契約的兩半。
 *
 * `changes` 是可以自動套用的字詞替換，`observations` 是要人判斷的觀察——
 * 兩者需要的注意力完全不同，硬塞成一顆按鈕只會兩邊都做不好。
 */
const QUICK_TASKS = [
  {
    key: 'check' as const,
    label: '一鍵校驗',
    icon: 'sparkles' as const,
    hint: '錯字加疑點一起跑。多數時候按這一顆就好。',
    task: 'review' as const,
    primary: true,
    instruction:
      '完整跑一次：changes 放可以直接替換的錯字、別字、標點誤用與明顯語病；' +
      'observations 放需要我自己判斷的疑點——段落之間互相矛盾的說法、沒有註明出處的' +
      '引用與數據、前後兜不攏的年份或數字、讀者需要卻沒有交代的東西。' +
      '不確定的事一律寫進 observations，不要寫成 changes 假裝自己知道答案。' +
      '任何可能改變原意的修改都要把 meaningChanged 標成 true。',
  },
  {
    key: 'typo' as const,
    label: '只找錯字',
    icon: 'scissors' as const,
    hint: '錯字、標點、明顯的語病。不動語意，也不提疑點。',
    task: 'review' as const,
    primary: false,
    instruction:
      '只做校對：挑出錯字、別字、標點誤用與明顯的語病，逐項列進 changes。' +
      '不要改寫句子、不要調整段落、不要更動語氣或用詞偏好。' +
      '任何可能改變原意的修改都要把 meaningChanged 標成 true。' +
      'observations 給空陣列。',
  },
  {
    key: 'images' as const,
    label: '一鍵配圖',
    icon: 'image-plus' as const,
    hint: '想出該配什麼圖與生圖用的 prompt。不會產生圖片。',
    task: 'images' as const,
    primary: false,
    instruction:
      '只做配圖需求：讀完文章之後，把「哪一段該放什麼圖」寫進 imageBriefs。' +
      'prompt 要具體到可以直接貼進生圖工具（畫面內容、風格、光線、構圖），' +
      'placement 講清楚放在第幾段之後，altText 要能替代圖片本身。' +
      'changes 與 observations 給空陣列。',
  },
];

const PRESETS = [
  '把過長的段落拆開，每段一個重點。',
  '統一全形標點，並把口語的贅字拿掉。',
  '第二段太長，拆成兩段。',
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

  if (running && job.agentRun) {
    return (
      <div className="stack">
        <AgentBusy run={job.agentRun} />
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

      <Field label="常做的" hint="按下去直接跑，不用打字。結果會列進清單，文章不會自己被改掉。">
        <div className="quick-tasks">
          {QUICK_TASKS.map((quick) => (
            <button
              key={quick.key}
              type="button"
              className="quick-task"
              data-primary={quick.primary ? 'yes' : 'no'}
              disabled={send.busy || job.currentRevision === null}
              onClick={() =>
                void send.run(async () => {
                  await api.runAgent(job.uuid, {
                    provider,
                    task: quick.task,
                    instruction: quick.instruction,
                  });
                  await refresh();
                })
              }
            >
              <Icon name={quick.icon} size={16} />
              <span className="quick-task-text">
                <span className="quick-task-label">{quick.label}</span>
                <span className="quick-task-hint">{quick.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="其他要求"
        hint="要它針對內容做別的事才需要打字。留空的話用上面兩顆就好。"
      >
        <textarea
          className="input textarea"
          rows={4}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="例如：把第三段的例子換成更貼近讀者的。"
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
