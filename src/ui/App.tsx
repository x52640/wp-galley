import { useCallback, useEffect, useState, type JSX } from 'react';
import { api, isFixtureMode, setFixtureMode } from './service/client.js';
import { ConfirmProvider } from './components/ConfirmDialog.js';
import { Diagnostics } from './components/Diagnostics.js';
import { JobList } from './components/JobList.js';
import { NewJob } from './components/NewJob.js';
import { SETUP_SKIPPED_KEY, SetupWizard } from './components/SetupWizard.js';
import { Workspace } from './components/Workspace.js';
import { Icon } from './icons.js';
import { keepEditOnOpen } from './lib/write-in-place.js';

/**
 * 路由。
 *
 * 用 hash 而不是 History API：這是本機工具，後端不必為前端路由多開任何路徑，
 * 重新整理也不會 404。五個畫面就夠了，不值得為此裝一個 router 套件。
 */

type Route =
  | { name: 'list' }
  | { name: 'new'; target?: string }
  | { name: 'job'; uuid: string }
  | { name: 'diagnostics' }
  | { name: 'setup' };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '/new') return { name: 'new' };
  const preset = /^\/new\/([^/]+)$/.exec(path);
  if (preset?.[1]) return { name: 'new', target: decodeURIComponent(preset[1]) };
  if (path === '/diagnostics') return { name: 'diagnostics' };
  if (path === '/setup') return { name: 'setup' };
  const job = /^\/jobs\/([^/]+)$/.exec(path);
  if (job?.[1]) return { name: 'job', uuid: decodeURIComponent(job[1]) };
  return { name: 'list' };
}

function go(path: string): void {
  window.location.hash = path;
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  /** 在總覽拖放或貼上的原稿，帶進新稿件畫面。只活在這一次導覽裡。 */
  const [pendingText, setPendingText] = useState<string | undefined>(undefined);
  /**
   * 剛建好、要直接進打字模式的那一篇（P5-T029）。只對建立後第一次打開生效：重新整理、離開那一篇
   * （回總覽、上一頁、換到別篇）、進了打字模式、載入失敗都會清掉（審查 #4，keepEditOnOpen）。
   */
  const [editOnOpen, setEditOnOpen] = useState<string | null>(null);
  const fixtures = isFixtureMode();

  useEffect(() => {
    const onChange = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // 畫面離開剛建好的那一篇就作廢「直接進打字模式」。只跟著 route 跑：建立當下（還在新稿件畫面）不會被清掉，
  // 導覽到那一篇時 route 對得上、留著。
  useEffect(() => {
    setEditOnOpen((pending) => keepEditOnOpen(pending, route));
  }, [route]);

  // 還沒設定（沒有 WordPress 連線或沒有站台設定檔）就自動進設定精靈；已經設定好就不打擾（P8-T002）。
  // 只在打開發布台時看一次，而且只從稿件總覽轉過去：使用者直接開某篇稿件的網址時不搶走畫面。
  // 按了「先跳過」的這次開著期間不再自動進來。
  useEffect(() => {
    if (parse(window.location.hash).name !== 'list') return;
    try {
      if (window.sessionStorage.getItem(SETUP_SKIPPED_KEY) === '1') return;
    } catch {
      /* storage 被擋就照常檢查 */
    }
    let cancelled = false;
    api
      .getSetupStatus()
      .then((status) => {
        if (!cancelled && status.needsSetup && parse(window.location.hash).name === 'list') go('/setup');
      })
      .catch(() => {
        // 後端沒開的話總覽自己會講；這裡不另外報錯。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openJob = useCallback((uuid: string) => go(`/jobs/${encodeURIComponent(uuid)}`), []);
  const backToList = useCallback(() => {
    setPendingText(undefined);
    setEditOnOpen(null);
    go('/');
  }, []);
  const startNew = useCallback((target?: string, text?: string) => {
    setPendingText(text);
    go(target === undefined ? '/new' : `/new/${encodeURIComponent(target)}`);
  }, []);
  const created = useCallback(
    (uuid: string, options: { edit: boolean }) => {
      setPendingText(undefined);
      setEditOnOpen(options.edit ? uuid : null);
      openJob(uuid);
    },
    [openJob],
  );

  return (
    <ConfirmProvider>
      {fixtures && (
        <div className="fixture-bar" role="status">
          <Icon name="alert" size={14} />
          <span>示範資料模式：畫面上的稿件都是假的，不會連到 WordPress。</span>
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            onClick={() => {
              setFixtureMode(false);
              window.location.href = window.location.pathname;
            }}
          >
            切回真實資料
          </button>
        </div>
      )}

      <div className="app" data-fixtures={fixtures ? 'yes' : 'no'}>
        {route.name === 'list' && <JobList onOpen={openJob} onNew={startNew} />}
        {route.name === 'new' && (
          <NewJob
            key={route.target ?? 'any'}
            presetTarget={route.target}
            initialText={pendingText}
            onCreated={created}
            onCancel={backToList}
          />
        )}
        {route.name === 'job' && (
          <Workspace
            uuid={route.uuid}
            onBack={backToList}
            startEditing={editOnOpen === route.uuid}
            onStartedEditing={() => setEditOnOpen(null)}
          />
        )}
        {route.name === 'diagnostics' && <Diagnostics onBack={backToList} />}
        {route.name === 'setup' && <SetupWizard onDone={backToList} onExit={backToList} />}
      </div>

    </ConfirmProvider>
  );
}
