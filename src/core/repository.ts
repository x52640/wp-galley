import type { DatabaseSync } from 'node:sqlite';
import type { JobState } from './state-machine.js';
import type { LoadedTemplate } from '../templates/types.js';
import type { PublishTarget } from '../wordpress/targets.js';

/**
 * CoreService 的 SQLite 存取層。
 *
 * 只做「把 row 讀出來／寫回去」，不做任何判斷。核准會不會失效、狀態能不能轉、
 * 發布前要檢查什麼，全部在 service.ts——那些是安全規則，只能有一份實作。
 * 把規則寫進 repository 會讓 MCP 之後有機會繞過去。
 *
 * node:sqlite 是同步 API，`.all()` 回傳 `Record<string, SQLOutputValue>[]`，
 * 所以每個查詢都要 `as unknown as` 轉型；欄位名稱與 001-init.ts 必須一致。
 */

export type RevisionOrigin = 'source' | 'agent_review' | 'media' | 'template_switch' | 'chat' | 'manual';
export type EventActor = 'ui' | 'mcp' | 'system';
export type EventStatus = 'started' | 'succeeded' | 'failed' | 'rejected';
export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';

export interface JobRow {
  readonly id: number;
  readonly uuid: string;
  readonly title: string | null;
  readonly target_id: number | null;
  readonly state: JobState;
  readonly workspace_path: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RevisionRow {
  readonly id: number;
  readonly job_id: number;
  readonly revision_number: number;
  readonly parent_revision_id: number | null;
  readonly template_row_id: number | null;
  readonly origin: RevisionOrigin;
  readonly content_hash: string;
  readonly source_text: string | null;
  readonly template_data_json: string | null;
  readonly rendered_html: string | null;
  readonly created_at: string;
}

export interface ApprovalRow {
  readonly id: number;
  readonly job_id: number;
  readonly revision_id: number;
  readonly content_hash: string;
  readonly kind: 'publish' | 'restore';
  readonly created_by: string;
  readonly created_at: string;
  readonly revoked_at: string | null;
  readonly revoke_reason: string | null;
}

export interface MediaAssetRow {
  readonly id: number;
  readonly job_id: number;
  readonly brief_key: string | null;
  readonly local_path: string;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly sha256: string;
  readonly alt_text: string | null;
  readonly caption: string | null;
  readonly wordpress_media_id: number | null;
  readonly uploaded_at: string | null;
  readonly created_at: string;
}

export interface WordPressObjectRow {
  readonly id: number;
  readonly site_id: number | null;
  readonly job_id: number | null;
  readonly object_type: string;
  readonly wordpress_id: number;
  readonly status: string | null;
  readonly link: string | null;
  readonly remote_hash: string | null;
  readonly remote_modified_gmt: string | null;
  readonly last_synced_at: string;
}

export interface AgentRunRow {
  readonly id: number;
  readonly job_id: number | null;
  readonly revision_id: number | null;
  readonly provider: string;
  readonly model: string | null;
  readonly purpose: string;
  readonly status: AgentRunStatus;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly input_hash: string | null;
  readonly output_hash: string | null;
  readonly usage_json: string | null;
  readonly error_message: string | null;
}

export interface PublishEventRow {
  readonly id: number;
  readonly job_id: number;
  readonly revision_id: number | null;
  readonly approval_id: number | null;
  readonly actor: EventActor;
  readonly event_type: string;
  readonly status: EventStatus;
  readonly detail_json: string | null;
  readonly created_at: string;
}

function rowId(result: { lastInsertRowid: number | bigint }): number {
  return Number(result.lastInsertRowid);
}

export class Repository {
  constructor(private readonly db: DatabaseSync) {}

  // --- 設定同步 -------------------------------------------------------------

  /**
   * 把 config/publish-targets.json 的內容同步進 DB。
   *
   * 設定檔仍然是唯一真相，DB 這份只是為了讓 jobs.target_id 有東西可以指——
   * 稽核時才看得出「這個 job 當時發到哪個 target」。
   */
  syncTargets(targets: readonly PublishTarget[], siteId: number | null): Map<string, number> {
    const upsert = this.db.prepare(`
      INSERT INTO publish_targets
        (site_id, key, display_name, content_type, endpoint, post_type, fixed_object_id,
         template_id, allow_create, allow_update, require_second_confirmation, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (key) DO UPDATE SET
        site_id = excluded.site_id,
        display_name = excluded.display_name,
        content_type = excluded.content_type,
        endpoint = excluded.endpoint,
        post_type = excluded.post_type,
        fixed_object_id = excluded.fixed_object_id,
        template_id = excluded.template_id,
        allow_create = excluded.allow_create,
        allow_update = excluded.allow_update,
        require_second_confirmation = excluded.require_second_confirmation,
        updated_at = datetime('now')
    `);

    for (const target of targets) {
      upsert.run(
        siteId,
        target.key,
        target.displayName,
        target.contentType,
        target.restBase,
        target.postType,
        target.fixedObjectId,
        target.templateId,
        target.allowCreate ? 1 : 0,
        target.allowUpdate ? 1 : 0,
        target.requireSecondConfirmation ? 1 : 0,
      );
    }

    const rows = this.db
      .prepare('SELECT id, key FROM publish_targets')
      .all() as unknown as { id: number; key: string }[];
    return new Map(rows.map((row) => [row.key, row.id]));
  }

  /** 站台。沒設定 WordPress 時不建立，回傳 null。 */
  syncSite(site: { key: string; displayName: string; baseUrl: string; username: string } | null): number | null {
    if (!site) return null;
    this.db
      .prepare(`
        INSERT INTO sites (key, display_name, base_url, username, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT (key) DO UPDATE SET
          display_name = excluded.display_name,
          base_url = excluded.base_url,
          username = excluded.username,
          updated_at = datetime('now')
      `)
      .run(site.key, site.displayName, site.baseUrl, site.username);
    const row = this.db.prepare('SELECT id FROM sites WHERE key = ?').get(site.key) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }

  /**
   * 模板版本。每個 revision 記下用了哪一版、哪個 hash，模板改動後仍能辨識
   * 舊 revision 是怎麼渲染出來的。
   */
  syncTemplates(templates: readonly LoadedTemplate[]): Map<string, number> {
    const insert = this.db.prepare(`
      INSERT INTO templates (template_id, version, content_type, strictness, manifest_json, schema_json, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (template_id, version, hash) DO NOTHING
    `);
    for (const template of templates) {
      insert.run(
        template.manifest.id,
        template.manifest.version,
        template.manifest.contentType,
        template.manifest.strictness,
        JSON.stringify(template.manifest),
        JSON.stringify(template.schema),
        template.hash,
      );
    }

    const rows = this.db
      .prepare('SELECT id, hash FROM templates')
      .all() as unknown as { id: number; hash: string }[];
    return new Map(rows.map((row) => [row.hash, row.id]));
  }

  // --- jobs -----------------------------------------------------------------

  insertJob(input: {
    uuid: string;
    title: string | null;
    targetId: number | null;
    state: JobState;
    workspacePath: string | null;
  }): JobRow {
    const result = this.db
      .prepare('INSERT INTO jobs (uuid, title, target_id, state, workspace_path) VALUES (?, ?, ?, ?, ?)')
      .run(input.uuid, input.title, input.targetId, input.state, input.workspacePath);
    return this.jobById(rowId(result))!;
  }

  jobByUuid(uuid: string): JobRow | null {
    return (this.db.prepare('SELECT * FROM jobs WHERE uuid = ?').get(uuid) as unknown as JobRow) ?? null;
  }

  jobById(id: number): JobRow | null {
    return (this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as JobRow) ?? null;
  }

  listJobs(states?: readonly JobState[]): JobRow[] {
    if (states && states.length > 0) {
      const placeholders = states.map(() => '?').join(', ');
      return this.db
        .prepare(`SELECT * FROM jobs WHERE state IN (${placeholders}) ORDER BY id DESC`)
        .all(...states) as unknown as JobRow[];
    }
    return this.db.prepare('SELECT * FROM jobs ORDER BY id DESC').all() as unknown as JobRow[];
  }

  updateJobState(jobId: number, state: JobState): void {
    this.db
      .prepare("UPDATE jobs SET state = ?, updated_at = datetime('now') WHERE id = ?")
      .run(state, jobId);
  }

  updateJobTitle(jobId: number, title: string | null): void {
    this.db
      .prepare("UPDATE jobs SET title = ?, updated_at = datetime('now') WHERE id = ?")
      .run(title, jobId);
  }

  targetKeyOf(targetId: number | null): string | null {
    if (targetId === null) return null;
    const row = this.db.prepare('SELECT key FROM publish_targets WHERE id = ?').get(targetId) as
      | { key: string }
      | undefined;
    return row?.key ?? null;
  }

  // --- revisions ------------------------------------------------------------

  insertRevision(input: {
    jobId: number;
    revisionNumber: number;
    parentRevisionId: number | null;
    templateRowId: number | null;
    origin: RevisionOrigin;
    contentHash: string;
    sourceText: string | null;
    templateDataJson: string;
    renderedHtml: string;
  }): RevisionRow {
    const result = this.db
      .prepare(`
        INSERT INTO revisions
          (job_id, revision_number, parent_revision_id, template_row_id, origin,
           content_hash, source_text, template_data_json, rendered_html)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.jobId,
        input.revisionNumber,
        input.parentRevisionId,
        input.templateRowId,
        input.origin,
        input.contentHash,
        input.sourceText,
        input.templateDataJson,
        input.renderedHtml,
      );
    return this.revisionById(rowId(result))!;
  }

  revisionById(id: number): RevisionRow | null {
    return (this.db.prepare('SELECT * FROM revisions WHERE id = ?').get(id) as unknown as RevisionRow) ?? null;
  }

  latestRevision(jobId: number): RevisionRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM revisions WHERE job_id = ? ORDER BY revision_number DESC LIMIT 1')
        .get(jobId) as unknown as RevisionRow) ?? null
    );
  }

  /** 上一版，用來算校對符號。 */
  previousRevision(jobId: number, revisionNumber: number): RevisionRow | null {
    return (
      (this.db
        .prepare(
          'SELECT * FROM revisions WHERE job_id = ? AND revision_number < ? ORDER BY revision_number DESC LIMIT 1',
        )
        .get(jobId, revisionNumber) as unknown as RevisionRow) ?? null
    );
  }

  listRevisions(jobId: number): RevisionRow[] {
    return this.db
      .prepare('SELECT * FROM revisions WHERE job_id = ? ORDER BY revision_number ASC')
      .all(jobId) as unknown as RevisionRow[];
  }

  // --- approvals ------------------------------------------------------------

  /**
   * `created_by` 寫死 'ui'。DB 的 CHECK 也只接受 'ui'——即使日後有人在
   * service 裡寫錯，DB 還會再擋一次（階段 5 契約第一節第 3 條）。
   */
  insertApproval(input: { jobId: number; revisionId: number; contentHash: string }): ApprovalRow {
    const result = this.db
      .prepare(
        "INSERT INTO approvals (job_id, revision_id, content_hash, kind, created_by) VALUES (?, ?, ?, 'publish', 'ui')",
      )
      .run(input.jobId, input.revisionId, input.contentHash);
    return this.approvalById(rowId(result))!;
  }

  approvalById(id: number): ApprovalRow | null {
    return (this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as unknown as ApprovalRow) ?? null;
  }

  /** 最近一筆核准，含已撤銷的。UI 要靠它畫出「印章被撕掉了」。 */
  latestApproval(jobId: number): ApprovalRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM approvals WHERE job_id = ? AND kind = 'publish' ORDER BY id DESC LIMIT 1")
        .get(jobId) as unknown as ApprovalRow) ?? null
    );
  }

  /** 尚未撤銷的核准。發布前置檢查只認這個。 */
  activeApproval(jobId: number): ApprovalRow | null {
    return (
      (this.db
        .prepare(
          "SELECT * FROM approvals WHERE job_id = ? AND kind = 'publish' AND revoked_at IS NULL ORDER BY id DESC LIMIT 1",
        )
        .get(jobId) as unknown as ApprovalRow) ?? null
    );
  }

  revokeApprovals(jobId: number, reason: string): number {
    const result = this.db
      .prepare(
        "UPDATE approvals SET revoked_at = datetime('now'), revoke_reason = ? WHERE job_id = ? AND revoked_at IS NULL",
      )
      .run(reason, jobId);
    return Number(result.changes);
  }

  // --- media ----------------------------------------------------------------

  insertMedia(input: {
    jobId: number;
    briefKey: string | null;
    localPath: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    altText: string | null;
    caption: string | null;
    wordpressMediaId: number | null;
    uploadedAt: string | null;
  }): MediaAssetRow {
    const result = this.db
      .prepare(`
        INSERT INTO media_assets
          (job_id, brief_key, local_path, mime_type, byte_size, sha256, alt_text, caption,
           wordpress_media_id, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.jobId,
        input.briefKey,
        input.localPath,
        input.mimeType,
        input.byteSize,
        input.sha256,
        input.altText,
        input.caption,
        input.wordpressMediaId,
        input.uploadedAt,
      );
    return this.mediaById(rowId(result))!;
  }

  updateMedia(
    id: number,
    input: {
      localPath: string;
      mimeType: string;
      byteSize: number;
      sha256: string;
      altText: string | null;
      caption: string | null;
      wordpressMediaId: number | null;
      uploadedAt: string | null;
    },
  ): MediaAssetRow {
    this.db
      .prepare(`
        UPDATE media_assets
        SET local_path = ?, mime_type = ?, byte_size = ?, sha256 = ?, alt_text = ?, caption = ?,
            wordpress_media_id = ?, uploaded_at = ?
        WHERE id = ?
      `)
      .run(
        input.localPath,
        input.mimeType,
        input.byteSize,
        input.sha256,
        input.altText,
        input.caption,
        input.wordpressMediaId,
        input.uploadedAt,
        id,
      );
    return this.mediaById(id)!;
  }

  mediaById(id: number): MediaAssetRow | null {
    return (this.db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id) as unknown as MediaAssetRow) ?? null;
  }

  listMedia(jobId: number): MediaAssetRow[] {
    return this.db
      .prepare('SELECT * FROM media_assets WHERE job_id = ? ORDER BY id ASC')
      .all(jobId) as unknown as MediaAssetRow[];
  }

  deleteMedia(id: number): void {
    this.db.prepare('DELETE FROM media_assets WHERE id = ?').run(id);
  }

  // --- wordpress objects ----------------------------------------------------

  /**
   * 記下我們在 WordPress 上動過的東西。
   *
   * `remote_hash` 與 `remote_modified_gmt` 是「發布前確認遠端沒被別人改過」
   * 的依據——沒有它就只能無聲覆蓋別人的修改。
   */
  upsertWordPressObject(input: {
    siteId: number | null;
    jobId: number | null;
    objectType: string;
    wordpressId: number;
    status: string | null;
    link: string | null;
    remoteHash: string | null;
    remoteModifiedGmt: string | null;
  }): WordPressObjectRow {
    const existing = this.db
      .prepare('SELECT * FROM wordpress_objects WHERE object_type = ? AND wordpress_id = ?')
      .get(input.objectType, input.wordpressId) as unknown as WordPressObjectRow | undefined;

    if (existing) {
      this.db
        .prepare(`
          UPDATE wordpress_objects
          SET site_id = ?, job_id = ?, status = ?, link = ?, remote_hash = ?, remote_modified_gmt = ?,
              last_synced_at = datetime('now')
          WHERE id = ?
        `)
        .run(
          input.siteId,
          input.jobId,
          input.status,
          input.link,
          input.remoteHash,
          input.remoteModifiedGmt,
          existing.id,
        );
      return this.wordpressObjectById(existing.id)!;
    }

    const result = this.db
      .prepare(`
        INSERT INTO wordpress_objects
          (site_id, job_id, object_type, wordpress_id, status, link, remote_hash, remote_modified_gmt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.siteId,
        input.jobId,
        input.objectType,
        input.wordpressId,
        input.status,
        input.link,
        input.remoteHash,
        input.remoteModifiedGmt,
      );
    return this.wordpressObjectById(rowId(result))!;
  }

  wordpressObjectById(id: number): WordPressObjectRow | null {
    return (
      (this.db.prepare('SELECT * FROM wordpress_objects WHERE id = ?').get(id) as unknown as WordPressObjectRow) ?? null
    );
  }

  /** 這個 job 發布出去的文章（不含媒體）。 */
  publishedObject(jobId: number): WordPressObjectRow | null {
    return (
      (this.db
        .prepare(
          "SELECT * FROM wordpress_objects WHERE job_id = ? AND object_type <> 'media' ORDER BY id DESC LIMIT 1",
        )
        .get(jobId) as unknown as WordPressObjectRow) ?? null
    );
  }

  mediaObject(wordpressId: number): WordPressObjectRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM wordpress_objects WHERE object_type = 'media' AND wordpress_id = ?")
        .get(wordpressId) as unknown as WordPressObjectRow) ?? null
    );
  }

  // --- agent runs -----------------------------------------------------------

  insertAgentRun(input: {
    jobId: number;
    revisionId: number | null;
    provider: string;
    model: string | null;
    purpose: string;
    status: AgentRunStatus;
    inputHash: string | null;
  }): AgentRunRow {
    const result = this.db
      .prepare(`
        INSERT INTO agent_runs (job_id, revision_id, provider, model, purpose, status, input_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(input.jobId, input.revisionId, input.provider, input.model, input.purpose, input.status, input.inputHash);
    return this.agentRunById(rowId(result))!;
  }

  finishAgentRun(
    id: number,
    input: { status: AgentRunStatus; outputHash: string | null; errorMessage: string | null; revisionId?: number | null },
  ): void {
    this.db
      .prepare(`
        UPDATE agent_runs
        SET status = ?, finished_at = datetime('now'), output_hash = ?, error_message = ?,
            revision_id = COALESCE(?, revision_id)
        WHERE id = ?
      `)
      .run(input.status, input.outputHash, input.errorMessage, input.revisionId ?? null, id);
  }

  agentRunById(id: number): AgentRunRow | null {
    return (this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as unknown as AgentRunRow) ?? null;
  }

  latestAgentRun(jobId: number): AgentRunRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM agent_runs WHERE job_id = ? ORDER BY id DESC LIMIT 1')
        .get(jobId) as unknown as AgentRunRow) ?? null
    );
  }

  runningAgentRun(jobId: number): AgentRunRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM agent_runs WHERE job_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1")
        .get(jobId) as unknown as AgentRunRow) ?? null
    );
  }

  // --- 稽核 -----------------------------------------------------------------

  /** 每一次核准、撤銷、發布嘗試都要留下紀錄，事後才查得出「誰在什麼時候放行了什麼」。 */
  insertEvent(input: {
    jobId: number;
    revisionId: number | null;
    approvalId: number | null;
    actor: EventActor;
    eventType: string;
    status: EventStatus;
    detail?: unknown;
  }): PublishEventRow {
    const result = this.db
      .prepare(`
        INSERT INTO publish_events (job_id, revision_id, approval_id, actor, event_type, status, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.jobId,
        input.revisionId,
        input.approvalId,
        input.actor,
        input.eventType,
        input.status,
        input.detail === undefined ? null : JSON.stringify(input.detail),
      );
    return this.db
      .prepare('SELECT * FROM publish_events WHERE id = ?')
      .get(rowId(result)) as unknown as PublishEventRow;
  }

  listEvents(jobId: number, limit = 50): PublishEventRow[] {
    return this.db
      .prepare('SELECT * FROM publish_events WHERE job_id = ? ORDER BY id DESC LIMIT ?')
      .all(jobId, limit) as unknown as PublishEventRow[];
  }
}
