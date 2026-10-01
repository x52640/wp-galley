import type { Migration } from '../migrate.js';

/**
 * AI 查證（D-034，P6-T004；docs/specs/factcheck.md「存下來的結果」）。
 *
 * **不放 `review_items`**：`runAgentReview` 每跑一次就把舊提案結掉，放在一起的話按一次「校驗」
 * 就把查證結果洗掉（跟配圖需求不放 `review_items` 同一個理由）。
 *
 * - `factcheck_runs`：每按一次查證一筆。兩趟 Agent 各自照舊記一筆 `agent_runs`（purpose `factcheck`），
 *   這裡記整次的狀態、目前階段與計數；抓網頁與核對階段沒有 CLI 在跑，畫面的進度靠這一筆。
 * - `factcheck_findings`：每條主張一筆，程式核對過的結果。`sources_json` 是給畫面的來源清單
 *   （網址、標題、來源種類、引文、核對結果、抓不到的原因、引文前後文）；**抓回的全文不存**。
 *   `blockIndex` 與「原句已經改了」讀取時算，不存。
 */
export const migration009: Migration = {
  id: '009',
  name: 'factcheck',
  sql: `
CREATE TABLE factcheck_runs (
  id                  INTEGER PRIMARY KEY,
  job_id              INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- 發起時的那一版。
  revision_id         INTEGER REFERENCES revisions(id) ON DELETE SET NULL,
  scope               TEXT NOT NULL CHECK (scope IN ('selection', 'observation', 'article')),
  provider            TEXT NOT NULL CHECK (provider IN ('codex', 'claude', 'google')),
  -- 第一趟有沒有開廠商端搜尋（agy 沒有）。決定 Agent 給的網址算 agent-search 還是 agent-memory。
  hosted_search       INTEGER NOT NULL DEFAULT 0 CHECK (hosted_search IN (0, 1)),
  status              TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  stage               TEXT NOT NULL CHECK (stage IN ('find', 'fetch', 'judge', 'verify')),
  candidate_count     INTEGER NOT NULL DEFAULT 0,
  fetched_count       INTEGER NOT NULL DEFAULT 0,
  fetch_failed_count  INTEGER NOT NULL DEFAULT 0,
  -- AI 引的句子文章裡找不到而丟掉的主張數。
  dropped_claim_count INTEGER NOT NULL DEFAULT 0,
  -- 第二趟（判斷）有沒有跑。一份來源都沒抓到就不跑（省一次額度）。
  judged              INTEGER NOT NULL DEFAULT 0 CHECK (judged IN (0, 1)),
  find_agent_run_id   INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  judge_agent_run_id  INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at         TEXT,
  error_message       TEXT
);

CREATE INDEX idx_factcheck_runs_job ON factcheck_runs (job_id, id);

CREATE TABLE factcheck_findings (
  id                   INTEGER PRIMARY KEY,
  run_id               INTEGER NOT NULL REFERENCES factcheck_runs(id) ON DELETE CASCADE,
  job_id               INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ordinal              INTEGER NOT NULL,
  excerpt              TEXT NOT NULL,
  claim                TEXT NOT NULL,
  -- 核對後的結果；agent_verdict 是 AI 原本說的（被降級時畫面要講）。
  verdict              TEXT NOT NULL CHECK (verdict IN ('supported', 'contradicted', 'unverifiable', 'needs-context')),
  agent_verdict        TEXT NOT NULL CHECK (agent_verdict IN ('supported', 'contradicted', 'unverifiable', 'needs-context')),
  evidence             TEXT NOT NULL,
  correction           TEXT,
  sources_json         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'dismissed', 'resolved-by-edit', 'superseded')),
  -- resolved-by-edit：哪一版結的案。
  resolved_revision_id INTEGER REFERENCES revisions(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at          TEXT
);

CREATE INDEX idx_factcheck_findings_job ON factcheck_findings (job_id, status);
`,
};
