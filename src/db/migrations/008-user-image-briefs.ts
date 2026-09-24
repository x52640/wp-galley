import type { Migration } from '../migrate.js';

/**
 * 在文章上直接請 AI 配一張（D-022，P5-T018）。
 *
 * 「在這裡插圖」→「請 AI 配一張」建的配圖需求跟 Agent 建議的共用 `image_briefs`：候選圖、再生一張、
 * 用這張全部沿用同一條路。多三欄把兩種分開：
 *
 * - `origin`：`agent`（一鍵配圖／校稿順便給的）或 `user`（使用者在某個位置請 AI 配的）。
 *   使用者那條的 `prompt` 是系統組好的整份生圖指令（前後段落＋使用者那句話＋固定約束），
 *   生圖時直接用，不再包進「畫面描述」。它永遠不是封面。
 * - `anchor_position`：圖放在錨點那段的 `after`（之後，原本唯一的做法）或 `before`（之前）。
 *   `before` 只給「文章最前面」這種前面沒有段落可以引用的位置用。
 * - `user_note`：使用者選填的那一句「想要什麼樣的圖」，原樣留著給畫面顯示。
 *
 * 舊資料全部是 Agent 給的：預設值就是舊行為。
 */
export const migration008: Migration = {
  id: '008',
  name: 'user-image-briefs',
  sql: `
ALTER TABLE image_briefs ADD COLUMN origin TEXT NOT NULL DEFAULT 'agent' CHECK (origin IN ('agent', 'user'));
ALTER TABLE image_briefs ADD COLUMN anchor_position TEXT NOT NULL DEFAULT 'after' CHECK (anchor_position IN ('after', 'before'));
ALTER TABLE image_briefs ADD COLUMN user_note TEXT;
`,
};
