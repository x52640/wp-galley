/** 前後端共用的 HTTP 契約：狀態、來源、Agent 種類等列舉。規則見 api.ts 開頭；前端與後端一律從 `api.ts` import。 */

// --- 列舉 -------------------------------------------------------------------

export const JOB_STATES = [
  'SOURCE',
  'REVIEWED',
  'MEDIA_READY',
  'RENDERED',
  'PREVIEWED',
  'APPROVED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
] as const;

export type JobState = (typeof JOB_STATES)[number];

export type RevisionOrigin = 'source' | 'agent_review' | 'media' | 'template_switch' | 'chat' | 'manual';

export type AgentProvider = 'codex' | 'claude' | 'google';

export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';

/**
 * 這一趟要 Agent 做什麼。
 *
 * `review` 是校稿（產生待處理清單），`images` 是配圖需求（產生 imageBriefs）。
 * 兩者共用同一份輸出 schema，差別在 prompt 與**結果怎麼落地**——配圖那一趟
 * 不會建立提案，所以按「一鍵配圖」不會把還沒清完的校稿清單洗掉。
 */
export type AgentTask = 'review' | 'images';

/**
 * `agent_runs` 裡記的一趟是在做什麼：`AgentTask` 之外多兩種——`generate-image`
 * （用 Codex 訂閱生圖，D-017）與 `suggest-slug`（AI 建議英文網址，D-026）。
 * 兩者都不走 `POST /agent`，所以不放進 `AgentTask`。
 */
export type AgentRunTask = AgentTask | 'generate-image' | 'suggest-slug';

/** 存成草稿與直接公開是兩個不同的決定。 */
export type PublishStatus = 'draft' | 'publish';

export type ReviewItemType = 'change' | 'observation';
export type ReviewItemState = 'pending' | 'applied' | 'skipped' | 'unappliable';
