import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../icons.js';

/**
 * 診斷頁：一眼看出「哪些東西已經接好了、哪些還沒」。
 *
 * 階段 5 之後這頁不再是首頁，改掛在 #/diagnostics。發布失敗時第一個該來的
 * 就是這裡：連不連得上、權限夠不夠、內容類型在不在、Agent 登入了沒。
 *
 * 等發布失敗才發現就太晚了。
 *
 * 絕不顯示任何秘密：後端回傳的就只有「有沒有設定」，連遮蔽過的密碼都沒有。
 */

interface Health {
  status: string;
  version: string;
  server: { host: string; port: number; nodeEnv: string };
  database: { ok: boolean; migrations: number };
  wordpress: { url: string; username: string; appPasswordConfigured: boolean } | null;
  templates: { id: string; contentType: string; strictness: string; hash: string }[];
  agents: {
    id: string;
    displayName: string;
    installed: boolean;
    version: string | null;
    loginState: string;
    available: boolean;
  }[];
}

interface WordPressProbe {
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  identity: { user: { id: number; name: string; slug: string }; roles: string[] } | null;
  targets: { postType: string; present: boolean; restBase: string | null; taxonomies: string[] }[];
  problems: string[];
  targetIssues: { targetKey: string; message: string }[];
  publishTargets: {
    key: string;
    displayName: string;
    postType: string;
    templateId: string;
    taxonomy: string | null;
    requireFeaturedImage: boolean;
  }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function Diagnostics({ onBack }: { onBack: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [wp, setWp] = useState<WordPressProbe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      // WordPress 探查會真的連線，可能要幾秒；健康檢查是本機的，先顯示出來。
      setHealth(await getJson<Health>('/api/health'));
      setWp(await getJson<WordPressProbe>('/api/wordpress'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="diagnostics">
      <header className="page-head">
        <div>
          <button type="button" className="btn btn-quiet btn-tiny" onClick={onBack}>
            <Icon name="arrow-left" size={14} />
            回到發布台
          </button>
          <h1>環境診斷</h1>
          <p className="stage">階段 5／7：發布台端到端</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={checking}>
          {checking ? '檢查中…' : '重新檢查'}
        </button>
      </header>

      {error && <p className="bad">無法連上後端：{error}</p>}
      {!health && !error && <p>載入中…</p>}

      {health && (
        <>
          <Section title="本機服務">
            <dl>
              <dt>後端</dt>
              <dd className={health.status === 'ok' ? 'good' : 'bad'}>
                {health.status} · v{health.version} · {health.server.host}:{health.server.port} ·{' '}
                {health.server.nodeEnv}
              </dd>
              <dt>資料庫</dt>
              <dd className={health.database.ok ? 'good' : 'bad'}>
                {health.database.ok ? `已套用 ${health.database.migrations} 個 migration` : '無法讀取'}
              </dd>
            </dl>
          </Section>

          <Section title="WordPress">
            {!wp && <p className="pending">檢查中…</p>}
            {wp && <WordPressPanel probe={wp} config={health.wordpress} />}
          </Section>

          <Section title="模板">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>內容類型</th>
                  <th>嚴格度</th>
                  <th>hash</th>
                </tr>
              </thead>
              <tbody>
                {health.templates.map((template) => (
                  <tr key={template.id}>
                    <td>{template.id}</td>
                    <td>{template.contentType}</td>
                    <td>{template.strictness}</td>
                    <td className="mono dim">{template.hash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Agent">
            <table>
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>版本</th>
                  <th>登入</th>
                  <th>可用</th>
                </tr>
              </thead>
              <tbody>
                {health.agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>{agent.displayName}</td>
                    <td className="mono dim">{agent.version ?? '—'}</td>
                    <td>{agent.loginState === 'logged-in' ? '已登入' : agent.loginState}</td>
                    <td className={agent.available ? 'good' : 'bad'}>{agent.available ? '是' : '否'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function WordPressPanel({
  probe,
  config,
}: {
  probe: WordPressProbe;
  config: Health['wordpress'];
}) {
  if (!probe.configured) {
    return (
      <p className="pending">
        尚未設定。請在 <code>.env</code> 填入 <code>WORDPRESS_URL</code>、
        <code>WORDPRESS_USERNAME</code> 與 <code>WORDPRESS_APP_PASSWORD</code>。
      </p>
    );
  }

  return (
    <>
      <dl>
        <dt>網站</dt>
        <dd className="mono">{config?.url ?? '—'}</dd>
        <dt>連線</dt>
        <dd className={probe.reachable ? 'good' : 'bad'}>{probe.reachable ? '連得上' : '連不上'}</dd>
        <dt>認證</dt>
        <dd className={probe.authenticated ? 'good' : 'bad'}>
          {probe.authenticated && probe.identity
            ? `${probe.identity.user.name}（${probe.identity.user.slug}，${probe.identity.roles.join('、')}）`
            : '失敗'}
        </dd>
      </dl>

      {probe.publishTargets.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>發布目標</th>
              <th>內容類型</th>
              <th>分類法</th>
              <th>精選圖片</th>
              <th>遠端</th>
            </tr>
          </thead>
          <tbody>
            {probe.publishTargets.map((target) => {
              const remote = probe.targets.find((t) => t.postType === target.postType);
              return (
                <tr key={target.key}>
                  <td>{target.displayName}</td>
                  <td className="mono">{target.postType}</td>
                  <td className="mono dim">{target.taxonomy ?? '—'}</td>
                  <td>{target.requireFeaturedImage ? '必填' : '選填'}</td>
                  <td className={remote?.present ? 'good' : 'bad'}>{remote?.present ? '存在' : '找不到'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {[...probe.problems, ...probe.targetIssues.map((i) => `${i.targetKey}：${i.message}`)].map(
        (problem) => (
          <p className="bad problem" key={problem}>
            {problem}
          </p>
        ),
      )}
    </>
  );
}
