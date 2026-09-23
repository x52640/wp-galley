import type { Migration } from '../migrate.js';

/**
 * 校稿提案與待處理清單（階段 5.5）。
 *
 * **為什麼 Agent 的輸出不再直接變成新版本。**
 * 原本 `runAgentReview` 一拿到結果就建 revision，等於「整份接受」。那代表 Agent
 * 改了九個地方、八個對、一個把原意改掉了，使用者只能全收或全退。計畫 §358 要的是
 * 「逐項接受、拒絕或全部接受」，而 `meaningChanged` 為真的項目**預設不套用**——
 * 直接落地就違反了這一條。
 *
 * 所以 Agent 的輸出先存成提案，內容一個字都不動；使用者勾選之後才走
 * `createRevision`，核准失效那一套照樣生效（而且時機才對：內容真的改了才失效）。
 *
 * **為什麼分兩張表。** 提案是一次執行的產物（整份 templateData 只有一份），
 * 但清單上的每一項各自有自己的下場。混在一個 JSON 欄位裡的話，套用一項就要重寫
 * 整包，而且查不出「哪幾項被略過了」——那是事後要回答的問題。
 */
export const migration003: Migration = {
  id: '003',
  name: 'review-proposals',
  sql: `
CREATE TABLE review_proposals (
  id                 INTEGER PRIMARY KEY,
  job_id             INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  agent_run_id       INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  -- 這份提案是對著哪一版做的。內容之後被別的動作改過，提案就可能對不上了。
  base_revision_id   INTEGER NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  base_content_hash  TEXT NOT NULL,
  provider           TEXT NOT NULL,
  summary            TEXT,
  -- Agent 交回來的整份 templateData。只有「全部接受」會用到它。
  proposed_data_json TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at          TEXT,
  close_reason       TEXT
);

-- 一個 job 同一時間只該有一份未結案的提案；查詢也永遠是「這個 job 的 open 那筆」。
CREATE INDEX idx_review_proposals_open ON review_proposals (job_id, status);

CREATE TABLE review_items (
  id           INTEGER PRIMARY KEY,
  proposal_id  INTEGER NOT NULL REFERENCES review_proposals(id) ON DELETE CASCADE,
  -- Agent 列出來的順序。逐項套用靠它依序定位，不能重排。
  ordinal      INTEGER NOT NULL,
  item_type    TEXT NOT NULL CHECK (item_type IN ('change', 'observation')),
  -- unappliable：想套用但在目前的內容裡定位不到，得使用者自己改。
  state        TEXT NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending', 'applied', 'skipped', 'unappliable')),
  payload_json TEXT NOT NULL,
  -- 套用之後產生的是哪一版，讓事後查得出「這個字是哪一次改的」。
  revision_id  INTEGER REFERENCES revisions(id) ON DELETE SET NULL,
  resolved_at  TEXT,
  UNIQUE (proposal_id, ordinal)
);

CREATE INDEX idx_review_items_pending ON review_items (proposal_id, state);
`,
};
