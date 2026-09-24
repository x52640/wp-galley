import type { DatabaseSync } from 'node:sqlite';
import type { JobState } from './state-machine.js';
import type { LoadedTemplate } from '../templates/types.js';
import type { PublishTarget } from '../wordpress/targets.js';
import type { AgentRunStatus, ReviewItemState, ReviewItemType, RevisionOrigin } from '../contract/api.js';

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

// 會過網路的列舉定義在 src/contract/api.ts，這裡轉出去讓既有的 import 不用改。
export type { AgentRunStatus, ReviewItemState, ReviewItemType, RevisionOrigin };
export type EventActor = 'ui' | 'mcp' | 'system';
export type EventStatus = 'started' | 'succeeded' | 'failed' | 'rejected';

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
  /** 完整的 RemoteSnapshot（JSON）。null 代表這一列還沒有比對基準。 */
  readonly remote_snapshot_json: string | null;
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
  /** migration 005：生圖那一趟在畫哪一條配圖需求。 */
  readonly image_brief_id: number | null;
}

/** migration 005：Codex 生出來、還只在本機的候選圖。 */
export interface ImageCandidateRow {
  readonly id: number;
  readonly job_id: number;
  readonly image_brief_id: number;
  readonly agent_run_id: number | null;
  readonly local_path: string;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly sha256: string;
  readonly created_at: string;
  readonly media_asset_id: number | null;
  readonly used_at: string | null;
}

export type ReviewProposalStatus = 'open' | 'closed';

export interface ReviewProposalRow {
  readonly id: number;
  readonly job_id: number;
  readonly agent_run_id: number | null;
  readonly base_revision_id: number;
  readonly base_content_hash: string;
  readonly provider: string;
  readonly summary: string | null;
  readonly proposed_data_json: string;
  readonly status: ReviewProposalStatus;
  readonly created_at: string;
  readonly closed_at: string | null;
  readonly close_reason: string | null;
}

export interface ReviewItemRow {
  readonly id: number;
  readonly proposal_id: number;
  readonly ordinal: number;
  readonly item_type: ReviewItemType;
  readonly state: ReviewItemState;
  readonly payload_json: string;
  readonly revision_id: number | null;
  readonly resolved_at: string | null;
}

export interface ImageBriefRow {
  readonly id: number;
  readonly job_id: number;
  readonly agent_run_id: number | null;
  readonly brief_key: string;
  readonly purpose: string;
  readonly prompt: string;
  readonly aspect_ratio: string;
  readonly alt_text: string;
  readonly caption: string | null;
  readonly placement: string | null;
  /** 這張圖要跟在後面的那一段的原文（migration 006）。封面與舊資料是 null。 */
  readonly anchor: string | null;
  readonly created_at: string;
  readonly dismissed_at: string | null;
  /** migration 008（P5-T018）：`agent`＝Agent 建議的；`user`＝使用者在文章上請 AI 配的。 */
  readonly origin: 'agent' | 'user';
  /** 圖放在錨點那段之後（`after`，舊資料都是）或之前（`before`，只給文章最前面用）。 */
  readonly anchor_position: 'after' | 'before';
  /** 使用者那句「想要什麼樣的圖」；沒寫或 Agent 的是 null。 */
  readonly user_note: string | null;
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
   * service 裡寫錯，DB 還會再擋一次（docs/specs/state-machine.md 不可妥協的規則第 3 條）。
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
    /** 完整快照的 JSON。沒有就寫 null，代表「沒有比對基準」。 */
    remoteSnapshotJson?: string | null;
  }): WordPressObjectRow {
    // 同一個 WordPress id 在不同站是不同的東西（P8-T002：設定精靈可以換站），所以找既有列要連站一起比。
    // site_id 是 NULL 的舊列（沒有站台紀錄時寫的）視為同一站，照舊更新它，不另建一列。
    const existing = this.db
      .prepare(
        `SELECT * FROM wordpress_objects
         WHERE object_type = ? AND wordpress_id = ? AND (site_id IS ? OR site_id IS NULL)
         ORDER BY site_id IS NULL LIMIT 1`,
      )
      .get(input.objectType, input.wordpressId, input.siteId) as unknown as WordPressObjectRow | undefined;

    if (existing) {
      this.db
        .prepare(`
          UPDATE wordpress_objects
          SET site_id = ?, job_id = ?, status = ?, link = ?, remote_hash = ?, remote_modified_gmt = ?,
              remote_snapshot_json = ?, last_synced_at = datetime('now')
          WHERE id = ?
        `)
        .run(
          input.siteId,
          input.jobId,
          input.status,
          input.link,
          input.remoteHash,
          input.remoteModifiedGmt,
          input.remoteSnapshotJson ?? null,
          existing.id,
        );
      return this.wordpressObjectById(existing.id)!;
    }

    const result = this.db
      .prepare(`
        INSERT INTO wordpress_objects
          (site_id, job_id, object_type, wordpress_id, status, link, remote_hash, remote_modified_gmt,
           remote_snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        input.remoteSnapshotJson ?? null,
      );
    return this.wordpressObjectById(rowId(result))!;
  }

  wordpressObjectById(id: number): WordPressObjectRow | null {
    return (
      (this.db.prepare('SELECT * FROM wordpress_objects WHERE id = ?').get(id) as unknown as WordPressObjectRow) ?? null
    );
  }

  /**
   * 這個 job 發布出去的文章（不含媒體）。
   *
   * 給 siteId 就只看那個站（site_id 是 NULL 的舊列算在內）：發布要更新的只能是**目前連的站**上的那篇。
   * 不給是畫面上的歷史紀錄（「發到哪、網址是什麼」），哪個站都算。
   */
  publishedObject(jobId: number, siteId?: number | null): WordPressObjectRow | null {
    if (siteId === undefined) {
      return (
        (this.db
          .prepare(
            "SELECT * FROM wordpress_objects WHERE job_id = ? AND object_type <> 'media' ORDER BY id DESC LIMIT 1",
          )
          .get(jobId) as unknown as WordPressObjectRow) ?? null
      );
    }
    return (
      (this.db
        .prepare(
          `SELECT * FROM wordpress_objects
           WHERE job_id = ? AND object_type <> 'media' AND (site_id IS ? OR site_id IS NULL)
           ORDER BY id DESC LIMIT 1`,
        )
        .get(jobId, siteId) as unknown as WordPressObjectRow) ?? null
    );
  }

  /** 這個 job 發到**別的站**的文章（最新一筆）；連同那個站的網址，錯誤訊息要講。 */
  publishedObjectOnOtherSite(jobId: number, siteId: number | null): (WordPressObjectRow & { base_url: string }) | null {
    return (
      (this.db
        .prepare(
          `SELECT o.*, s.base_url AS base_url FROM wordpress_objects o JOIN sites s ON s.id = o.site_id
           WHERE o.job_id = ? AND o.object_type <> 'media' AND o.site_id IS NOT ? 
           ORDER BY o.id DESC LIMIT 1`,
        )
        .get(jobId, siteId) as unknown as (WordPressObjectRow & { base_url: string }) | undefined) ?? null
    );
  }

  /**
   * 這個 job 上傳的這張圖記在哪些站。沒有站台紀錄（NULL）的不列。
   * 用 job 一起查：不同站的媒體庫編號會撞號。
   */
  mediaSiteIds(jobId: number, wordpressId: number): number[] {
    return (
      this.db
        .prepare(
          "SELECT DISTINCT site_id FROM wordpress_objects WHERE object_type = 'media' AND wordpress_id = ? AND job_id = ? AND site_id IS NOT NULL",
        )
        .all(wordpressId, jobId) as unknown as { site_id: number }[]
    ).map((row) => row.site_id);
  }

  /** 目前這個站的發布與上傳用量，設定精靈換站前要講「哪些不會跟過去」。 */
  siteUsage(siteId: number): { publishedJobs: number; uploadedMedia: number } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(DISTINCT CASE WHEN object_type <> 'media' THEN job_id END) AS published_jobs,
           COUNT(CASE WHEN object_type = 'media' THEN 1 END) AS uploaded_media
         FROM wordpress_objects WHERE site_id = ?`,
      )
      .get(siteId) as unknown as { published_jobs: number; uploaded_media: number };
    return { publishedJobs: row.published_jobs, uploadedMedia: row.uploaded_media };
  }

  /** 媒體的紀錄。給 siteId 時優先回那個站的（不同站的編號會撞號）。 */
  mediaObject(wordpressId: number, siteId?: number | null): WordPressObjectRow | null {
    return (
      (this.db
        .prepare(
          "SELECT * FROM wordpress_objects WHERE object_type = 'media' AND wordpress_id = ? ORDER BY site_id IS ? DESC, id DESC LIMIT 1",
        )
        .get(wordpressId, siteId ?? null) as unknown as WordPressObjectRow) ?? null
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
    imageBriefId?: number | null;
  }): AgentRunRow {
    const result = this.db
      .prepare(`
        INSERT INTO agent_runs (job_id, revision_id, provider, model, purpose, status, input_hash, image_brief_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.jobId,
        input.revisionId,
        input.provider,
        input.model,
        input.purpose,
        input.status,
        input.inputHash,
        input.imageBriefId ?? null,
      );
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

  // --- 校稿提案 -------------------------------------------------------------

  insertReviewProposal(input: {
    jobId: number;
    agentRunId: number | null;
    baseRevisionId: number;
    baseContentHash: string;
    provider: string;
    summary: string | null;
    proposedDataJson: string;
  }): ReviewProposalRow {
    const result = this.db
      .prepare(`
        INSERT INTO review_proposals
          (job_id, agent_run_id, base_revision_id, base_content_hash, provider, summary, proposed_data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.jobId,
        input.agentRunId,
        input.baseRevisionId,
        input.baseContentHash,
        input.provider,
        input.summary,
        input.proposedDataJson,
      );
    return this.reviewProposalById(rowId(result))!;
  }

  insertReviewItem(input: {
    proposalId: number;
    ordinal: number;
    itemType: ReviewItemType;
    payload: unknown;
  }): ReviewItemRow {
    const result = this.db
      .prepare('INSERT INTO review_items (proposal_id, ordinal, item_type, payload_json) VALUES (?, ?, ?, ?)')
      .run(input.proposalId, input.ordinal, input.itemType, JSON.stringify(input.payload));
    return this.db
      .prepare('SELECT * FROM review_items WHERE id = ?')
      .get(rowId(result)) as unknown as ReviewItemRow;
  }

  reviewProposalById(id: number): ReviewProposalRow | null {
    return (
      (this.db.prepare('SELECT * FROM review_proposals WHERE id = ?').get(id) as unknown as ReviewProposalRow) ??
      null
    );
  }

  /** 這個 job 目前未結案的提案。同一時間只該有一份。 */
  openReviewProposal(jobId: number): ReviewProposalRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM review_proposals WHERE job_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
        .get(jobId) as unknown as ReviewProposalRow) ?? null
    );
  }

  listReviewItems(proposalId: number): ReviewItemRow[] {
    return this.db
      .prepare('SELECT * FROM review_items WHERE proposal_id = ? ORDER BY ordinal')
      .all(proposalId) as unknown as ReviewItemRow[];
  }

  updateReviewItemState(id: number, state: ReviewItemState, revisionId: number | null): void {
    this.db
      .prepare(`
        UPDATE review_items
        SET state = ?, revision_id = COALESCE(?, revision_id),
            resolved_at = CASE WHEN ? = 'pending' THEN NULL ELSE datetime('now') END
        WHERE id = ?
      `)
      .run(state, revisionId, state, id);
  }

  /** 逐項套用之後，提案的比對基準要跟著換到新那一版，剩下的項目才還套得動。 */
  rebaseReviewProposal(id: number, revisionId: number, contentHash: string): void {
    this.db
      .prepare('UPDATE review_proposals SET base_revision_id = ?, base_content_hash = ? WHERE id = ?')
      .run(revisionId, contentHash, id);
  }

  closeReviewProposal(id: number, reason: string): void {
    this.db
      .prepare("UPDATE review_proposals SET status = 'closed', closed_at = datetime('now'), close_reason = ? WHERE id = ? AND status = 'open'")
      .run(reason, id);
  }

  // --- 配圖需求 -------------------------------------------------------------

  /** 同一個 key 覆蓋掉上一次的建議，並把「不要了」的標記清掉——這是新的一份。 */
  upsertImageBrief(input: {
    jobId: number;
    agentRunId: number | null;
    briefKey: string;
    purpose: string;
    prompt: string;
    aspectRatio: string;
    altText: string;
    caption: string | null;
    placement: string | null;
    anchor: string | null;
  }): void {
    this.db
      .prepare(`
        INSERT INTO image_briefs
          (job_id, agent_run_id, brief_key, purpose, prompt, aspect_ratio, alt_text, caption, placement, anchor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (job_id, brief_key) DO UPDATE SET
          agent_run_id = excluded.agent_run_id,
          purpose      = excluded.purpose,
          prompt       = excluded.prompt,
          aspect_ratio = excluded.aspect_ratio,
          alt_text     = excluded.alt_text,
          caption      = excluded.caption,
          placement    = excluded.placement,
          anchor       = excluded.anchor,
          created_at   = datetime('now'),
          dismissed_at = NULL
      `)
      .run(
        input.jobId,
        input.agentRunId,
        input.briefKey,
        input.purpose,
        input.prompt,
        input.aspectRatio,
        input.altText,
        input.caption,
        input.placement,
        input.anchor,
      );
  }

  /**
   * 使用者在文章上請 AI 配一張（P5-T018）。key 每次都是新的（`user-` 開頭、亂數），所以直接 INSERT，
   * 不走 upsert；Agent 的建議碰不到它（Agent 給的 `user-` 開頭 key 在 service 裡就被改名了）。
   */
  insertUserImageBrief(input: {
    jobId: number;
    briefKey: string;
    purpose: string;
    prompt: string;
    aspectRatio: string;
    altText: string;
    anchor: string | null;
    anchorPosition: 'after' | 'before';
    userNote: string | null;
  }): ImageBriefRow {
    const result = this.db
      .prepare(`
        INSERT INTO image_briefs
          (job_id, agent_run_id, brief_key, purpose, prompt, aspect_ratio, alt_text, caption, placement, anchor,
           origin, anchor_position, user_note)
        VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, 'user', ?, ?)
      `)
      .run(
        input.jobId,
        input.briefKey,
        input.purpose,
        input.prompt,
        input.aspectRatio,
        input.altText,
        input.anchor,
        input.anchorPosition,
        input.userNote,
      );
    return this.imageBriefById(Number(result.lastInsertRowid))!;
  }

  listImageBriefs(jobId: number): ImageBriefRow[] {
    return this.db
      .prepare('SELECT * FROM image_briefs WHERE job_id = ? ORDER BY id')
      .all(jobId) as unknown as ImageBriefRow[];
  }

  imageBriefById(id: number): ImageBriefRow | null {
    return (
      (this.db.prepare('SELECT * FROM image_briefs WHERE id = ?').get(id) as unknown as ImageBriefRow) ?? null
    );
  }

  dismissImageBrief(id: number): void {
    this.db.prepare("UPDATE image_briefs SET dismissed_at = datetime('now') WHERE id = ?").run(id);
  }

  // --- 生圖候選圖（migration 005） -------------------------------------------

  insertImageCandidate(input: {
    jobId: number;
    imageBriefId: number;
    agentRunId: number | null;
    localPath: string;
    mimeType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    sha256: string;
  }): ImageCandidateRow {
    const result = this.db
      .prepare(`
        INSERT INTO image_candidates
          (job_id, image_brief_id, agent_run_id, local_path, mime_type, byte_size, width, height, sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.jobId,
        input.imageBriefId,
        input.agentRunId,
        input.localPath,
        input.mimeType,
        input.byteSize,
        input.width,
        input.height,
        input.sha256,
      );
    return this.imageCandidateById(rowId(result))!;
  }

  imageCandidateById(id: number): ImageCandidateRow | null {
    return (
      (this.db.prepare('SELECT * FROM image_candidates WHERE id = ?').get(id) as unknown as ImageCandidateRow) ??
      null
    );
  }

  /**
   * 每條配圖需求**最新的那一張**候選圖，而且還沒用掉。最新那張用掉了，就不會退回去
   * 顯示更早那張沒被選的——那會像是按了「用這張」之後又冒出一張舊圖。
   * 看 `used_at` 而不是 `media_asset_id`：媒體被移除時後者會變回 NULL。
   */
  latestOpenCandidates(jobId: number): ImageCandidateRow[] {
    return this.db
      .prepare(`
        SELECT * FROM image_candidates
        WHERE id IN (SELECT MAX(id) FROM image_candidates WHERE job_id = ? GROUP BY image_brief_id)
          AND used_at IS NULL
      `)
      .all(jobId) as unknown as ImageCandidateRow[];
  }

  /**
   * 搶下這張候選圖（「用這張」）。同步、單一 UPDATE，搶到回 true；已經被別的請求搶走回 false。
   * 兩個同時送來的請求因此只有一個會上傳。
   */
  claimImageCandidate(id: number): boolean {
    const result = this.db
      .prepare("UPDATE image_candidates SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL")
      .run(id);
    return Number(result.changes) === 1;
  }

  /** 上傳失敗時把搶下的放回去，候選圖回到卡片上。 */
  releaseImageCandidate(id: number): void {
    this.db.prepare('UPDATE image_candidates SET used_at = NULL WHERE id = ? AND media_asset_id IS NULL').run(id);
  }

  markImageCandidateUsed(id: number, mediaAssetId: number): void {
    this.db.prepare('UPDATE image_candidates SET media_asset_id = ? WHERE id = ?').run(mediaAssetId, id);
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
