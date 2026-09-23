import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { api, describeError, isFixtureMode } from '../service/client.js';
import { FIXTURE_SETUP_SCENARIOS, setFixtureSetupScenario, type FixtureSetupScenario } from '../service/fixtures.js';
import type {
  SetupAgent,
  SetupCheck,
  SetupConnectionResult,
  SetupDestinationKey,
  SetupDestinationsResponse,
  SetupStatus,
} from '../service/types.js';
import { Icon, type IconName } from '../icons.js';
import { ErrorNote, Spinner, useAction } from './panels/shared.js';
import { typeLabel } from './JobList.js';

/**
 * 首次設定精靈（P8-T002，D-016）。
 *
 * 別人裝好之後第一眼看到的畫面：四步，每一步失敗都講「發生什麼事、下一步做什麼」（D-008）。
 * 1 連線 WordPress → 2 AI 編輯 → 3 發到哪裡 → 4 完成。
 *
 * 密碼的規矩（docs/specs/security.md「設定精靈寫入的秘密」）：密碼欄是 uncontrolled input，
 * 按「測試連線」時才從 DOM 讀，不進 React state；測試通過就清空。之後「儲存」只送 testId。
 */

type Step = 1 | 2 | 3 | 4;

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: '連線 WordPress' },
  { step: 2, label: 'AI 編輯' },
  { step: 3, label: '發到哪裡' },
  { step: 4, label: '完成' },
];

/** 使用者按了「先跳過」：這次開著的期間不再自動進精靈。 */
export const SETUP_SKIPPED_KEY = 'publisher.setupSkipped';

export function SetupWizard({ onDone, onExit }: { onDone: () => void; onExit: () => void }): JSX.Element {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [reached, setReached] = useState<Step>(1);
  /** 第三步覆寫既有設定檔時留的備份，完成頁要講。 */
  const [backupFile, setBackupFile] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await api.getSetupStatus());
    } catch (cause) {
      setLoadError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const goTo = (next: Step): void => {
    setStep(next);
    setReached((current) => (next > current ? next : current));
    window.scrollTo({ top: 0 });
  };

  const skip = (): void => {
    try {
      window.sessionStorage.setItem(SETUP_SKIPPED_KEY, '1');
    } catch {
      /* 無痕視窗擋 storage：那就只是下次還會再進來 */
    }
    onExit();
  };

  return (
    <div className="b0">
      <header className="appbar">
        <span className="brand">發布台</span>
        {status !== null && !status.needsSetup && (
          <button type="button" className="btn btn-quiet btn-tiny" onClick={onExit}>
            <Icon name="x" size={14} />
            關閉設定
          </button>
        )}
      </header>

      <main className="setup">
        <div className="setup-head">
          <h1 className="compose-title">設定發布台</h1>
          <p className="setup-lede">
            連上你的 WordPress、看看 AI 編輯在不在、決定發到哪裡。全部存在這台電腦上，AI 碰不到你的網站。
          </p>
        </div>

        <ol className="setup-steps" aria-label="設定步驟">
          {STEPS.map((item) => {
            const state = item.step === step ? 'current' : item.step < reached || item.step < step ? 'done' : 'todo';
            const clickable = item.step <= reached && item.step !== step && step !== 4;
            return (
              <li key={item.step} data-state={state}>
                <button
                  type="button"
                  className="setup-step"
                  disabled={!clickable}
                  aria-current={item.step === step ? 'step' : undefined}
                  onClick={() => goTo(item.step)}
                >
                  <span className="setup-step-num" aria-hidden="true">
                    {state === 'done' ? <Icon name="check" size={13} strokeWidth={2.5} /> : item.step}
                  </span>
                  {item.label}
                </button>
              </li>
            );
          })}
        </ol>

        <ErrorNote message={loadError === null ? null : `讀不到目前的設定：${loadError}`} />
        {status === null && loadError === null && <p className="screen-loading">讀取目前的設定…</p>}

        {status !== null && !status.canWrite && (
          <p className="note note-warn" role="alert">
            <Icon name="alert" size={14} />
            <span>這個發布台是以不能寫設定檔的方式啟動的：可以測試，但存不起來。</span>
          </p>
        )}

        {status !== null && step === 1 && (
          <WordPressStep
            status={status}
            onSaved={(next) => {
              setStatus(next);
              goTo(2);
            }}
            onKeep={() => goTo(2)}
            onSkip={status.needsSetup ? skip : undefined}
          />
        )}
        {status !== null && step === 2 && <AgentsStep onNext={() => goTo(3)} />}
        {status !== null && step === 3 && (
          <DestinationStep
            status={status}
            onSaved={(next, backup) => {
              setStatus(next);
              setBackupFile(backup);
              goTo(4);
            }}
            onBack={() => goTo(1)}
          />
        )}
        {status !== null && step === 4 && <DoneStep status={status} backupFile={backupFile} onDone={onDone} />}
      </main>
    </div>
  );
}

// --- 第一步：WordPress ------------------------------------------------------------

function WordPressStep({
  status,
  onSaved,
  onKeep,
  onSkip,
}: {
  status: SetupStatus;
  onSaved: (status: SetupStatus) => void;
  onKeep: () => void;
  onSkip: (() => void) | undefined;
}): JSX.Element {
  const [editing, setEditing] = useState(status.wordpress === null);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [reveal, setReveal] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [result, setResult] = useState<SetupConnectionResult | null>(null);
  const [scenario, setScenario] = useState('ok');
  const [confirmSiteChange, setConfirmSiteChange] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const test = useAction();
  const save = useAction();
  const fixtures = isFixtureMode();

  if (!editing && status.wordpress !== null) {
    return (
      <section className="setup-panel" aria-labelledby="setup-wp-title">
        <h2 id="setup-wp-title" className="setup-panel-title">連線 WordPress</h2>
        <p className="note note-good">
          <Icon name="check-circle" size={14} />
          <span>
            已經連上 <span className="mono">{status.wordpress.url}</span>（帳號 {status.wordpress.username}）。
          </span>
        </p>
        <div className="setup-actions">
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
            換一組帳號或網站
          </button>
          <button type="button" className="btn btn-primary btn-big" onClick={onKeep}>
            沿用，下一步
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </section>
    );
  }

  /** 每 4 個字一組，跟 WordPress 顯示的一樣。直接改 DOM：密碼不進 React state。 */
  const formatPassword = (): void => {
    const input = passwordRef.current;
    if (!input) return;
    const bare = input.value.replace(/\s+/g, '');
    const grouped = bare.match(/.{1,4}/g)?.join(' ') ?? '';
    if (grouped !== input.value) input.value = grouped;
    setCharCount(bare.length);
    setResult(null);
  };

  const runTest = (): Promise<void> =>
    test.run(async () => {
      setResult(null);
      setConfirmSiteChange(false);
      if (fixtures) setFixtureSetupScenario(scenario as FixtureSetupScenario);
      const outcome = await api.testWordPressConnection({
        url,
        username,
        appPassword: passwordRef.current?.value ?? '',
      });
      setResult(outcome);
      if (outcome.ok && passwordRef.current) {
        // 通過了：密碼已經交給本機後端，畫面上不必再留著。
        passwordRef.current.value = '';
        setCharCount(0);
      }
      if (outcome.url && outcome.url !== url) setUrl(outcome.url);
    });

  const canTest = url.trim().length > 0 && username.trim().length > 0 && charCount > 0 && !test.busy;

  return (
    <section className="setup-panel" aria-labelledby="setup-wp-title">
      <h2 id="setup-wp-title" className="setup-panel-title">連線 WordPress</h2>
      <p className="setup-panel-lede">
        發布台用 WordPress 內建的「應用程式密碼」替你發文。測試連線只會讀取，不會在站上建立或修改任何東西。
      </p>

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (canTest) void runTest();
        }}
      >
        <label className="field">
          <span className="field-label">網站網址</span>
          <input
            className="input"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setResult(null);
            }}
            placeholder="https://example.com"
            autoComplete="url"
            spellCheck={false}
            inputMode="url"
          />
          <span className="field-hint">網站首頁的網址。從後台網址列複製也可以，結尾的 /wp-admin 會自動拿掉。</span>
        </label>

        <label className="field">
          <span className="field-label">帳號</span>
          <input
            className="input"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setResult(null);
            }}
            placeholder="登入後台用的使用者名稱或 email"
            autoComplete="username"
            spellCheck={false}
          />
          <span className="field-hint">建議另開一個「編輯」（Editor）角色的帳號專門給發布台用，不要用管理員。</span>
        </label>

        <div className="field">
          <label className="field-label" htmlFor="setup-app-password">
            應用程式密碼
          </label>
          <div className="row">
            <input
              id="setup-app-password"
              ref={passwordRef}
              className="input mono setup-password"
              type={reveal ? 'text' : 'password'}
              defaultValue=""
              onInput={formatPassword}
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="setup-app-password-hint"
            />
            <button type="button" className="btn btn-quiet" onClick={() => setReveal((value) => !value)} aria-pressed={reveal}>
              <Icon name="eye" size={14} />
              {reveal ? '藏起來' : '顯示'}
            </button>
          </div>
          <span id="setup-app-password-hint" className="field-hint">
            {charCount === 0 ? '24 個英文字母和數字，有沒有空格都可以。不是登入密碼。' : `${charCount}／24 個字`}
            {charCount > 24 && '：太長了，可能多貼了別的東西。'}
          </span>
        </div>

        <details className="setup-howto">
          <summary>應用程式密碼怎麼申請？</summary>
          <ol>
            <li>用要給發布台的那個帳號登入 WordPress 後台。</li>
            <li>左邊選「使用者 → 個人資料」。</li>
            <li>捲到最下面「應用程式密碼」，名稱填「發布台」，按「新增應用程式密碼」。</li>
            <li>把出現的那串 24 個字整串複製，貼到上面（空格一起貼沒關係）。它只會顯示這一次。</li>
          </ol>
          <p className="field-hint">
            找不到「應用程式密碼」這一區：站台要是 https，而且沒有被安全外掛關掉。測試連線會告訴你是哪一個。
          </p>
        </details>

        {fixtures && (
          <label className="field setup-fixture">
            <span className="field-label">示範：模擬測試結果</span>
            <select className="input select" value={scenario} onChange={(event) => setScenario(event.target.value)}>
              {FIXTURE_SETUP_SCENARIOS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="setup-actions">
          {onSkip && (
            <button type="button" className="btn btn-quiet" onClick={onSkip}>
              先跳過
            </button>
          )}
          {status.wordpress !== null && (
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
              取消，沿用原本的
            </button>
          )}
          <button type="submit" className={`btn btn-big ${result?.ok ? '' : 'btn-primary'}`} disabled={!canTest}>
            {test.busy ? <Spinner /> : <Icon name="refresh" size={15} />}
            {test.busy ? '測試中…' : result === null ? '測試連線' : '再測一次'}
          </button>
        </div>
      </form>

      {test.busy && <p className="field-hint setup-busy-note">只讀取，不會改站上任何東西。通常幾秒鐘。</p>}
      <ErrorNote message={test.error} />

      {result !== null && <ConnectionResult result={result} />}

      {result?.ok && result.testId !== null && (
        <>
          {result.siteChange && (
            <div className="setup-sitechange" role="alert">
              <p className="setup-problem-title setup-sitechange-title">
                <Icon name="alert" size={16} />
                你要換到另一個站
              </p>
              <p>
                從 <span className="mono">{result.siteChange.from}</span> 換到{' '}
                <span className="mono">{result.siteChange.to}</span>。存了之後：
              </p>
              <ul>
                <li>
                  已經發到舊站的 {result.siteChange.publishedJobs} 篇稿件還留在發布台，但<strong>不能再從這裡更新</strong>
                  （新站上沒有它們）；要改請到舊站後台，或把設定換回舊站。
                </li>
                <li>
                  傳到舊站媒體庫的 {result.siteChange.uploadedMedia} 張圖<strong>不會跟過去</strong>：
                  還沒發的稿件如果用了它們當封面或放在正文裡，發布前會被擋下，要在新站重新上傳。
                </li>
                <li>原稿、校稿建議、版本紀錄全部留著，舊站上的東西發布台一個都不動。</li>
              </ul>
              <label className="setup-replace">
                <input
                  type="checkbox"
                  checked={confirmSiteChange}
                  onChange={(event) => setConfirmSiteChange(event.target.checked)}
                />
                <span>我知道了，要換到新站</span>
              </label>
            </div>
          )}
          <ErrorNote message={save.error} />
          <div className="setup-actions">
            <span className="field-hint">會存進這台電腦的 .env（只有你讀得到），不用重新啟動。</span>
            <button
              type="button"
              className="btn btn-primary btn-big"
              disabled={save.busy || !status.canWrite || (result.siteChange !== null && !confirmSiteChange)}
              onClick={() =>
                void save.run(async () => {
                  const saved = await api.saveWordPressConnection(
                    result.testId!,
                    result.siteChange !== null ? confirmSiteChange : undefined,
                  );
                  onSaved(saved.status);
                })
              }
            >
              {save.busy ? <Spinner /> : null}
              儲存並繼續
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const CHECK_ICON: Record<SetupCheck['state'], IconName> = {
  ok: 'check-circle',
  fail: 'x-circle',
  warn: 'alert',
  skipped: 'circle',
};

const CHECK_WORD: Record<SetupCheck['state'], string> = {
  ok: '通過',
  fail: '卡在這裡',
  warn: '有提醒',
  skipped: '還沒測',
};

function ConnectionResult({ result }: { result: SetupConnectionResult }): JSX.Element {
  return (
    <div className="setup-result" aria-live="polite">
      <ul className="setup-checks">
        {result.checks.map((check) => (
          <li key={check.key} data-state={check.state}>
            <Icon name={CHECK_ICON[check.state]} size={16} />
            <span className="setup-check-label">{check.label}</span>
            <span className="setup-check-word">{CHECK_WORD[check.state]}</span>
          </li>
        ))}
      </ul>

      {result.problem && (
        <div className="setup-problem" role="alert">
          <p className="setup-problem-title">
            <Icon name="alert" size={16} />
            {result.problem.title}
          </p>
          <p>{result.problem.detail}</p>
          <p className="setup-problem-next">
            <strong>下一步：</strong>
            {result.problem.next}
          </p>
        </div>
      )}

      {result.ok && result.identity && (
        <p className="note note-good">
          <Icon name="check-circle" size={14} />
          <span>
            連上了：{result.identity.name}（{result.identity.roles.join('、') || '沒有角色'}）
            {result.url && (
              <>
                ，<span className="mono">{result.url}</span>
              </>
            )}
          </span>
        </p>
      )}

      {result.warnings.map((warning) => (
        <p key={warning} className="note note-warn">
          <Icon name="alert" size={14} />
          <span>{warning}</span>
        </p>
      ))}
    </div>
  );
}

// --- 第二步：Agent ---------------------------------------------------------------

function agentState(agent: SetupAgent): { word: string; tone: 'good' | 'warn' | 'bad' } {
  if (agent.available) return { word: '可以用', tone: 'good' };
  if (!agent.installed) return { word: '沒有安裝', tone: 'bad' };
  if (agent.loginState === 'logged-out') return { word: '還沒登入', tone: 'warn' };
  return { word: '無法確認登入', tone: 'warn' };
}

function AgentsStep({ onNext }: { onNext: () => void }): JSX.Element {
  const [agents, setAgents] = useState<SetupAgent[] | null>(null);
  const detect = useAction();

  const load = useCallback(
    () =>
      detect.run(async () => {
        setAgents(null);
        setAgents(await api.getSetupAgents());
      }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const usable = agents?.filter((agent) => agent.available) ?? [];

  return (
    <section className="setup-panel" aria-labelledby="setup-agent-title">
      <h2 id="setup-agent-title" className="setup-panel-title">AI 編輯</h2>
      <p className="setup-panel-lede">
        發布台請你已經訂閱、已經登入的 AI 幫忙校稿與配圖，不需要 API Key。至少有一個能用比較好；
        一個都沒有也能自己改稿、發布。<strong>只有 Codex 能生圖。</strong>
      </p>

      {agents === null && detect.busy && (
        <p className="screen-loading">
          <Spinner /> 偵測中（要問三個程式，可能要十幾秒）…
        </p>
      )}
      <ErrorNote message={detect.error} />

      {agents !== null && (
        <ul className="setup-agents">
          {agents.map((agent) => {
            const state = agentState(agent);
            return (
              <li key={agent.id} className="setup-agent" data-tone={state.tone}>
                <div className="setup-agent-head">
                  <span className="setup-agent-name">{agent.displayName}</span>
                  {agent.canGenerateImages && <span className="setup-tag">能生圖</span>}
                  <span className="setup-agent-state" data-tone={state.tone}>
                    <Icon name={state.tone === 'good' ? 'check-circle' : state.tone === 'warn' ? 'alert' : 'x-circle'} size={14} />
                    {state.word}
                  </span>
                </div>
                {agent.version && <p className="setup-agent-meta mono">{agent.version}</p>}
                {!agent.installed && (
                  <Command label="在終端機執行，安裝：" command={agent.installCommand} note={agent.installNote} />
                )}
                {agent.installed && !agent.available && (
                  <Command
                    label="在終端機執行，登入："
                    command={agent.loginCommand}
                    // 「尚未登入，請執行 …」跟上面的指令重複；只有無法確認時才多講原因。
                    note={agent.loginState === 'logged-out' ? null : agent.unavailableReason}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {agents !== null && usable.length === 0 && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>目前沒有能用的 AI 編輯。可以先繼續，裝好或登入之後按「重新偵測」，或之後從稿件總覽右上角的「設定」回來。</span>
        </p>
      )}
      {agents !== null && usable.length > 0 && !usable.some((agent) => agent.canGenerateImages) && (
        <p className="note note-info">
          <Icon name="alert" size={14} />
          <span>校稿可以用了。要讓 AI 直接生圖，得另外裝好並登入 Codex。</span>
        </p>
      )}

      <div className="setup-actions">
        <span className="field-hint">裝好或登入之後不用重開發布台，按「重新偵測」就好。</span>
        <button type="button" className="btn btn-quiet" onClick={() => void load()} disabled={detect.busy}>
          {detect.busy ? <Spinner /> : <Icon name="refresh" size={14} />}
          重新偵測
        </button>
        <button type="button" className="btn btn-primary btn-big" onClick={onNext} disabled={agents === null}>
          下一步
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </section>
  );
}

function Command({ label, command, note }: { label: string; command: string; note: string | null }): JSX.Element {
  const [copied, setCopied] = useState(false);
  // 「從網站下載」這種不是指令的，不給複製鈕。
  const isCommand = !command.startsWith('從 ');
  return (
    <div className="setup-command">
      <span className="field-hint">{isCommand ? label : '安裝：'}</span>
      <div className="row">
        <code className="setup-command-code">{command}</code>
        {isCommand && (
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            onClick={() => {
              void navigator.clipboard?.writeText(command).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            {copied ? '已複製' : '複製'}
          </button>
        )}
      </div>
      {note && <span className="field-hint">{note}</span>}
    </div>
  );
}

// --- 第三步：發到哪裡 ------------------------------------------------------------

function DestinationStep({
  status,
  onSaved,
  onBack,
}: {
  status: SetupStatus;
  onSaved: (status: SetupStatus, backupFile: string | null) => void;
  onBack: () => void;
}): JSX.Element {
  const [data, setData] = useState<SetupDestinationsResponse | null>(null);
  const [include, setInclude] = useState<SetupDestinationKey[]>([]);
  const [replace, setReplace] = useState<SetupDestinationKey[]>([]);
  const load = useAction();
  const save = useAction();

  useEffect(() => {
    void load.run(async () => {
      const response = await api.getSetupDestinations();
      setData(response);
      // 沒有設定檔：能選的預設全勾（通常就是要文章＋頁面）。已經有設定檔：預設什麼都不動。
      if (response.existing.length === 0) {
        setInclude(response.options.filter((option) => option.available).map((option) => option.key));
      }
    });
  }, []);

  const hasExisting = (data?.existing.length ?? 0) > 0;
  const conflicts = (data?.options ?? []).filter(
    (option) => include.includes(option.key) && option.existing !== null && !replace.includes(option.key),
  );
  const nothingChosen = include.length === 0;

  const toggle = (key: SetupDestinationKey): void => {
    setInclude((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  return (
    <section className="setup-panel" aria-labelledby="setup-dest-title">
      <h2 id="setup-dest-title" className="setup-panel-title">發到哪裡</h2>
      <p className="setup-panel-lede">
        文章與頁面都用通用排版：只用 WordPress 內建的區塊，不帶佈景主題的樣式，所以任何佈景主題都能顯示。分類只會從站上既有的挑，不會自動建立新分類。
      </p>

      {load.busy && <p className="screen-loading"><Spinner /> 讀取站上的內容類型…</p>}
      {load.error && (
        <>
          <ErrorNote message={load.error} />
          <div className="setup-actions">
            <button type="button" className="btn btn-quiet" onClick={onBack}>
              <Icon name="arrow-left" size={14} />
              回第一步
            </button>
          </div>
        </>
      )}

      {data !== null && (
        <>
          {hasExisting && (
            <div className="setup-existing">
              <p className="field-label">設定檔裡已經有這些，會原樣保留（精靈不會刪）：</p>
              <ul className="chips">
                {data.existing.map((target) => (
                  <li key={target.key} className="chip">
                    {target.displayName}
                    <span className="mono dim">{target.key}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="type-cards setup-dest-cards" role="group" aria-label="要加入的目的地">
            {data.options.map((option) => {
              const checked = include.includes(option.key);
              return (
                <div key={option.key} className="setup-dest">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    className="type-card"
                    data-active={checked ? 'yes' : 'no'}
                    disabled={!option.available}
                    onClick={() => toggle(option.key)}
                  >
                    <span className="type-card-name">
                      <span className="setup-checkbox" aria-hidden="true">
                        {checked && <Icon name="check" size={13} strokeWidth={2.5} />}
                      </span>
                      {option.displayName}
                    </span>
                    <span className="type-card-note">
                      {option.available ? (
                        <>
                          發到 WordPress 的 <span className="mono">{option.postType}</span>
                          {option.taxonomy !== null ? '，可以挑分類' : '，沒有分類'}
                        </>
                      ) : (
                        option.reason
                      )}
                    </span>
                  </button>
                  {option.existing !== null && checked && (
                    <label className="setup-replace">
                      <input
                        type="checkbox"
                        checked={replace.includes(option.key)}
                        onChange={(event) =>
                          setReplace((current) =>
                            event.target.checked ? [...current, option.key] : current.filter((key) => key !== option.key),
                          )
                        }
                      />
                      <span>
                        已經有「{option.existing.displayName}」。用精靈的設定取代它（原本的檔會先備份到 backups/）
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          {conflicts.length > 0 && (
            <p className="note note-warn" role="alert">
              <Icon name="alert" size={14} />
              <span>
                「{conflicts.map((option) => option.displayName).join('、')}」已經有了。要換掉就勾「取代」，不換就取消勾選。
              </span>
            </p>
          )}

          <ErrorNote message={save.error} />

          <div className="setup-actions">
            <span className="field-hint">存在這台電腦的 config/publish-targets.json，不用重新啟動。</span>
            {nothingChosen && hasExisting ? (
              <button type="button" className="btn btn-primary btn-big" onClick={() => onSaved(status, null)}>
                不改，下一步
                <Icon name="chevron-right" size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={save.busy || nothingChosen || conflicts.length > 0 || !status.canWrite}
                onClick={() =>
                  void save.run(async () => {
                    const saved = await api.saveSetupDestinations({ include, replace });
                    onSaved(saved.status, saved.backupFile);
                  })
                }
              >
                {save.busy ? <Spinner /> : null}
                儲存並繼續
                <Icon name="chevron-right" size={16} />
              </button>
            )}
          </div>
          {nothingChosen && !hasExisting && <p className="field-hint setup-why">至少選一個：不然沒有地方可以發。</p>}
        </>
      )}
    </section>
  );
}

// --- 第四步：完成 ----------------------------------------------------------------

function DoneStep({
  status,
  backupFile,
  onDone,
}: {
  status: SetupStatus;
  backupFile: string | null;
  onDone: () => void;
}): JSX.Element {
  return (
    <section className="setup-panel setup-done" aria-labelledby="setup-done-title">
      <h2 id="setup-done-title" className="setup-panel-title">
        <Icon name="check-circle" size={20} />
        設定好了
      </h2>
      <dl className="setup-summary">
        <SummaryRow label="網站">
          {status.wordpress ? (
            <>
              <span className="mono">{status.wordpress.url}</span>（帳號 {status.wordpress.username}）
            </>
          ) : (
            '還沒連線'
          )}
        </SummaryRow>
        <SummaryRow label="發到">
          {status.siteConfig.targets.length > 0
            ? status.siteConfig.targets
                .map((target) => {
                  const kind = typeLabel(target.contentType, target.postType);
                  return kind === target.displayName ? kind : `${kind}（${target.displayName}）`;
                })
                .join('、')
            : '還沒選'}
        </SummaryRow>
      </dl>
      {backupFile && (
        <p className="note note-info">
          <Icon name="check" size={14} />
          <span>
            原本的站台設定已備份到 <span className="mono">{backupFile}</span>。
          </span>
        </p>
      )}
      <p className="setup-panel-lede">不用重新啟動，現在就能開新稿。之後要改，按稿件總覽右上角的「設定」。</p>
      {status.needsSetup && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>還差一步：{status.wordpress === null ? '還沒連上 WordPress' : '還沒選要發到哪裡'}。沒有它就建不了稿。</span>
        </p>
      )}
      <div className="setup-actions">
        <button type="button" className="btn btn-primary btn-big" onClick={onDone}>
          進稿件總覽
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </section>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
