import { useCallback, useEffect, useState, type JSX } from 'react';
import { isFixtureMode, setFixtureMode } from './service/client.js';
import { ConfirmProvider } from './components/ConfirmDialog.js';
import { Diagnostics } from './components/Diagnostics.js';
import { JobList } from './components/JobList.js';
import { NewJob } from './components/NewJob.js';
import { Workspace } from './components/Workspace.js';
import { Icon } from './icons.js';

/**
 * 路由。
 *
 * 用 hash 而不是 History API：這是本機工具，後端不必為前端路由多開任何路徑，
 * 重新整理也不會 404。四個畫面就夠了，不值得為此裝一個 router 套件。
 */

type Route =
  | { name: 'list' }
  | { name: 'new'; target?: string }
  | { name: 'job'; uuid: string }
  | { name: 'diagnostics' };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '/new') return { name: 'new' };
  const preset = /^\/new\/([^/]+)$/.exec(path);
  if (preset?.[1]) return { name: 'new', target: decodeURIComponent(preset[1]) };
  if (path === '/diagnostics') return { name: 'diagnostics' };
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
  const fixtures = isFixtureMode();

  useEffect(() => {
    const onChange = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const openJob = useCallback((uuid: string) => go(`/jobs/${encodeURIComponent(uuid)}`), []);
  const backToList = useCallback(() => {
    setPendingText(undefined);
    go('/');
  }, []);
  const startNew = useCallback((target?: string, text?: string) => {
    setPendingText(text);
    go(target === undefined ? '/new' : `/new/${encodeURIComponent(target)}`);
  }, []);
  const created = useCallback(
    (uuid: string) => {
      setPendingText(undefined);
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
        {route.name === 'job' && <Workspace uuid={route.uuid} onBack={backToList} />}
        {route.name === 'diagnostics' && <Diagnostics onBack={backToList} />}
      </div>

    </ConfirmProvider>
  );
}
