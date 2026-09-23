import type { Migration } from '../migrate.js';

/**
 * 配圖需求（階段 5.5 的「一鍵配圖」）。
 *
 * **這裡不生圖。** 三個 Agent CLI 都不能產生圖片（用它們自己的 `--help` 確認過），
 * 圖片生成 API 也還沒選。所以「配圖」這件事能自動化的部分只有前半段：讓 Agent
 * 讀完文章之後說出「哪一段該放什麼圖、prompt 長怎樣、比例多少、alt 寫什麼」，
 * 使用者拿著這份需求去生圖，回來直接在同一格上傳。
 *
 * **為什麼不塞進 review_items。** 配圖需求不是「接受或拒絕」的東西，它是一份採買
 * 清單：一個 brief 的下場是「圖片上傳好了」或「不要了」，不是「套用進文章」。
 * 而且 `runAgentReview` 每跑一次就會把舊提案結掉——配圖跟校稿共用容器的話，
 * 按一次「一鍵配圖」就會把還沒清完的校稿清單洗掉。兩件事各自存。
 *
 * `brief_key` 對得上 `media_assets.brief_key`：使用者上傳的圖是為了滿足哪一條
 * 需求，靠這個欄位接起來（那一欄 001 就有了，一直沒有東西去填它）。
 */
export const migration004: Migration = {
  id: '004',
  name: 'image-briefs',
  sql: `
CREATE TABLE image_briefs (
  id            INTEGER PRIMARY KEY,
  job_id        INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  agent_run_id  INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  brief_key     TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  aspect_ratio  TEXT NOT NULL,
  alt_text      TEXT NOT NULL,
  caption       TEXT,
  -- Agent 講的插入位置描述（「第三段之後」）。它不是索引，不能拿去當 blockIndex。
  placement     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- 使用者說「不要這張」的時間。不刪列，才看得出來曾經建議過什麼。
  dismissed_at  TEXT,

  -- 同一個 key 只留一條，重跑配圖就是覆蓋掉上一次的建議。
  UNIQUE (job_id, brief_key)
);

CREATE INDEX idx_image_briefs_open ON image_briefs (job_id, dismissed_at);
`,
};
