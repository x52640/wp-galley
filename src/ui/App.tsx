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
  | { name: 'new' }
  | { name: 'job'; uuid: string }
  | { name: 'diagnostics' };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '/new') return { name: 'new' };
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
  const fixtures = isFixtureMode();

  useEffect(() => {
    const onChange = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const openJob = useCallback((uuid: string) => go(`/jobs/${encodeURIComponent(uuid)}`), []);
  const backToList = useCallback(() => go('/'), []);

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
        {route.name === 'list' && <JobList onOpen={openJob} onNew={() => go('/new')} />}
        {route.name === 'new' && <NewJob onCreated={openJob} onCancel={backToList} />}
        {route.name === 'job' && <Workspace uuid={route.uuid} onBack={backToList} />}
        {route.name === 'diagnostics' && <Diagnostics onBack={backToList} />}
      </div>

      {route.name !== 'diagnostics' && (
        <a className="diag-link" href="#/diagnostics">
          <Icon name="gauge" size={13} />
          環境診斷
        </a>
      )}
    </ConfirmProvider>
  );
}
