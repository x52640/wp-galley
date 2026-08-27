import { useEffect, useState } from 'react';

interface Health {
  status: string;
  stage: number;
  version: string;
  server: { host: string; port: number; nodeEnv: string };
  database: { ok: boolean; migrations: number };
  wordpress: { url: string; username: string; appPasswordConfigured: boolean } | null;
  agents: { detected: boolean; note: string };
}

/**
 * 階段 1 的 UI 只有診斷頁：確認後端活著、資料庫已 migrate、設定有沒有讀到。
 * 真正的發布台工作區在階段 5 才建。
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main>
      <h1>本機 WordPress 發布台</h1>
      <p className="stage">階段 1：安全本機骨架</p>

      {error && <p className="bad">無法連上後端：{error}</p>}
      {!health && !error && <p>載入中…</p>}

      {health && (
        <dl>
          <dt>服務</dt>
          <dd className={health.status === 'ok' ? 'good' : 'bad'}>
            {health.status} · v{health.version} · {health.server.host}:{health.server.port}
          </dd>

          <dt>資料庫</dt>
          <dd className={health.database.ok ? 'good' : 'bad'}>
            {health.database.ok ? `已套用 ${health.database.migrations} 個 migration` : '無法讀取'}
          </dd>

          <dt>WordPress</dt>
          <dd className={health.wordpress ? 'good' : 'pending'}>
            {health.wordpress
              ? `${health.wordpress.url}（使用者 ${health.wordpress.username}，Application Password 已設定）`
              : '尚未設定（階段 4 才需要）'}
          </dd>

          <dt>Agent</dt>
          <dd className="pending">{health.agents.note}</dd>
        </dl>
      )}
    </main>
  );
}
