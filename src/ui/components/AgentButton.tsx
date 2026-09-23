import { useEffect, useRef, useState, type JSX } from 'react';
import { api } from '../service/client.js';
import type { AgentProvider, LoadedJob } from '../service/types.js';
import { Icon } from '../icons.js';
import { PRESETS, PROVIDERS, QUICK_TASKS, loadProvider, saveProvider } from '../lib/agent-tasks.js';
import { Spinner, useAction } from './panels/shared.js';

/**
 * 「請 AI 看一遍」（B1 頂列）。
 *
 * 主按鈕就是最常做的那件事：一鍵校驗。旁邊的小箭頭打開選單，放比較少用的：
 * 只找錯字、一鍵配圖、換一家 Agent、自己交代要求。
 *
 * 結果**不會**直接改文章：校稿變成右邊的建議卡片，配圖變成圖片區的配圖建議。
 * 跑的時候頂端有進度長條（AgentBanner），這顆按鈕只負責送出。
 */

const CHECK = QUICK_TASKS.find((task) => task.key === 'check')!;

export function AgentButton({
  job,
  refresh,
  onError,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [provider, setProvider] = useState<AgentProvider>(loadProvider);
  const [menuOpen, setMenuOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const send = useAction();
  const wrapRef = useRef<HTMLDivElement>(null);

  const running = job.agentRun?.status === 'running';
  const disabled = send.busy || running || job.currentRevision === null;

  useEffect(() => onError(send.error), [send.error, onError]);

  // 點選單外面或按 Esc 就收起來。
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const run = (task: 'review' | 'images', text: string): void => {
    setMenuOpen(false);
    void send.run(async () => {
      const pending = api.runAgent(job.uuid, { provider, task, instruction: text });
      // 這個請求要等 Agent 跑完才回來（幾十秒到幾分鐘）。先重讀一次，讓工作區看到
      // 「執行中」並開始輪詢，頂端的進度長條才會出現。
      window.setTimeout(() => void refresh(), 500);
      await pending;
      await refresh();
    });
  };

  const providerLabel = PROVIDERS.find((option) => option.id === provider)?.label ?? provider;

  return (
    <div className="split" ref={wrapRef}>
      <button
        type="button"
        className="btn split-main"
        disabled={disabled}
        onClick={() => run(CHECK.task, CHECK.instruction)}
        title={`交給 ${providerLabel}：錯字加疑點一起跑`}
      >
        {send.busy || running ? <Spinner /> : <Icon name="sparkles" size={16} />}
        {running ? 'AI 看稿中…' : '請 AI 看一遍'}
      </button>
      <button
        type="button"
        className="btn split-toggle"
        aria-label="更多 AI 動作"
        aria-expanded={menuOpen}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Icon name="chevron-down" size={15} />
      </button>

      {menuOpen && (
        <div className="menu" role="menu">
          {QUICK_TASKS.filter((task) => task.key !== 'check').map((task) => (
            <button
              key={task.key}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => run(task.task, task.instruction)}
            >
              <Icon name={task.icon} size={16} />
              <span className="menu-item-text">
                <span className="menu-item-label">{task.label}</span>
                <span className="menu-item-hint">{task.hint}</span>
              </span>
            </button>
          ))}

          <div className="menu-sep" role="separator" />

          <div className="menu-block">
            <span className="menu-block-label">交給哪一個</span>
            <div className="segmented" role="radiogroup" aria-label="Agent">
              {PROVIDERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={provider === option.id}
                  className="segmented-item"
                  data-active={provider === option.id ? 'yes' : 'no'}
                  onClick={() => {
                    setProvider(option.id);
                    saveProvider(option.id);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="menu-sep" role="separator" />

          <div className="menu-block">
            <label className="menu-block-label" htmlFor="agent-instruction">
              自己交代要求
            </label>
            <textarea
              id="agent-instruction"
              className="input textarea"
              rows={3}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="例如：把第三段的例子換成更貼近讀者的。"
            />
            <div className="chips">
              {PRESETS.map((preset) => (
                <button key={preset} type="button" className="chip" onClick={() => setInstruction(preset)}>
                  {preset}
                </button>
              ))}
            </div>
            <div className="row row-end">
              <button
                type="button"
                className="btn btn-primary"
                disabled={instruction.trim().length === 0}
                onClick={() => {
                  run('review', instruction.trim());
                  setInstruction('');
                }}
              >
                <Icon name="sparkles" size={14} />
                送出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
