/** CoreService 方法的輸入型別（P5-T004 從 service.ts 拆出；門面 `../service.ts` 原名轉出）。 */

import type { DatabaseSync } from 'node:sqlite';
import type { AgentTask, AutoFeatureResult, AutoPlaceResult, FactCheckScope, MediaAsset } from '../../contract/api.js';
import type { EventActor, RevisionOrigin } from '../repository.js';
import type { Scrubber } from '../../config/secrets.js';
import { AgentRegistry } from '../../agents/registry.js';
import type { AgentId } from '../../agents/types.js';
import type { TemplateRegistry } from '../../templates/registry.js';
import type { WordPressClient } from '../../wordpress/client.js';
import type { PublishTargetRegistry } from '../../wordpress/targets.js';
import type { SourceFetcher } from '../../fetch/index.js';

export interface CreateJobInput {
  readonly targetKey: string;
  readonly sourceText: string;
  readonly title?: string | undefined;
  /** 已經有結構化資料就直接給；沒給就由 sourceText 決定性地轉成段落。 */
  readonly templateData?: Record<string, unknown> | undefined;
}

export interface CreateRevisionInput {
  readonly origin?: RevisionOrigin | undefined;
  /** 整份取代目前的 templateData；沒給就沿用上一版。 */
  readonly templateData?: Record<string, unknown> | undefined;
  /** 直接在文章上改：只換正文（publishSlot），其他欄位沿用上一版。見 normalizeEditedBody。 */
  readonly editedBody?: string | undefined;
  /** 從哪張建議卡片進去改的：存成新版本時一起標成已處理。只能跟 editedBody／editedTitle 一起用（P5-T031）。 */
  readonly resolveItemId?: number | undefined;
  /** 從哪張查證卡片「去原文改」進來的：存成新版本時那條標成 resolved-by-edit。只能跟 editedBody／editedTitle 一起用（P6-T004）。 */
  readonly resolveFactCheckId?: number | undefined;
  /** 在文章上直接改的標題（P5-T029）：只換 title。純文字、一行、非空（contract/plain-title.ts）。 */
  readonly editedTitle?: string | undefined;
  readonly sourceText?: string | undefined;
  /** `null` 代表清除精選圖片；`undefined` 代表沿用。 */
  readonly featuredMediaId?: number | null | undefined;
  /** 稽核用的說明，也會寫進核准撤銷的理由。 */
  readonly reason?: string | undefined;
  /** 這次編輯根據的那一版 content hash；給了而目前版本不是它，就丟 ContentChangedError。 */
  readonly expectedContentHash?: string | undefined;
}

/** 後端收到的是解碼後的位元組；線上的樣子是 MediaUploadRequest（base64）。 */
export interface AddMediaInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
  readonly altText?: string | undefined;
  readonly caption?: string | undefined;
  readonly briefKey?: string | undefined;
}

/** 上傳的結果：圖，加上封面有沒有自動設精選、內文圖有沒有照錨點自動放進正文。 */
export interface MediaUploadOutcome {
  readonly media: MediaAsset;
  readonly autoFeature: AutoFeatureResult | null;
  readonly autoPlace: AutoPlaceResult | null;
}

export interface ResolveReviewInput {
  readonly itemIds: readonly number[];
  readonly decision: 'apply' | 'skip';
}

/**
 * 認一份特定的提案。
 *
 * 「全部接受」與「丟棄」都是整份操作，只帶 job uuid 的話認的是「目前那一份」——
 * 確認對話框開著的時候如果又跑了一次校稿，按下去就會作用在使用者沒看過的那一份上。
 * 逐項處理不需要這個：itemIds 本身就只屬於某一份提案，換過就對不上了。
 */
export interface ProposalRef {
  readonly proposalId?: number | undefined;
}

export interface AgentReviewInput {
  readonly provider: AgentId;
  /** 預設 `review`。 */
  readonly task?: AgentTask | undefined;
  readonly model?: string | undefined;
  /** 使用者在聊天框打的字。不受信任內容，會被明確標示邊界。 */
  readonly instruction?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/** AI 建議英文網址（D-026，P5-T026）。輸入內容一律是目前這一版，呼叫端只選交給哪一家。 */
export interface SlugSuggestionInput {
  readonly provider: AgentId;
  readonly model?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/** AI 查證（D-034，P6-T004）。範圍與輸入規則見 docs/specs/factcheck.md「① 找來源」。 */
export interface FactCheckInput {
  readonly provider: AgentId;
  readonly scope: FactCheckScope;
  /** `selection` 才給：選的那段字。 */
  readonly selection?: string | undefined;
  /** `observation` 才給：校稿觀察卡片的 id。 */
  readonly observationItemId?: number | undefined;
  readonly model?: string | undefined;
  /** 每一趟 Agent 的逾時。 */
  readonly timeoutMs?: number | undefined;
}

/**
 * 每次查證建一個取回器（共用同一份額度）。正式啟動由 `server/app.ts` 給真的（`src/fetch`），測試一律給假的。
 * `signal`：使用者按停止時 abort，取回器要中止正在抓的請求。
 */
export type FactCheckFetcherFactory = (input: {
  /** 目前這一版的純文字（外洩檢查的「文章片段」用）。 */
  readonly articleText: string;
  /** WordPress 密碼判斷（CoreService 的遮蔽器）。 */
  readonly containsSecret: (text: string) => boolean;
  readonly signal: AbortSignal;
}) => SourceFetcher;

export interface PublishInput {
  readonly status: 'draft' | 'publish';
  /** requireSecondConfirmation 的 target 需要 UI 再確認一次。 */
  readonly confirm?: boolean | undefined;
  /**
   * 這一篇的作者（P5-T024）。發布選項，不進 content_hash、不影響核准。
   * 不給用站台設定的預設作者；都沒有就不送 author。
   */
  readonly authorId?: number | undefined;
  /** 只有後端知道呼叫的是誰；HTTP 路由寫死 'ui'，MCP 另給。 */
  readonly actor?: EventActor | undefined;
}

/**
 * 存進 `revisions.template_data_json` 的信封。
 *
 * 為什麼不直接存 templateData：精選圖片是**會被發布出去的內容**，所以必須進
 * content_hash（換封面要讓核准失效）。但各模板的 schema.json 都是
 * `additionalProperties: false`，塞不進額外欄位，所以包一層信封。
 */
export interface RevisionPayload {
  readonly templateData: Record<string, unknown>;
  readonly featuredMediaAssetId: number | null;
}

export interface CoreServiceOptions {
  readonly db: DatabaseSync;
  readonly templates: TemplateRegistry;
  readonly targets: PublishTargetRegistry;
  readonly agents: AgentRegistry;
  /** 沒設定 WordPress 時是 null；需要連線的方法會丟 WordPressUnavailableError。 */
  readonly wordpress: WordPressClient | null;
  readonly site?: { key: string; displayName: string; baseUrl: string; username: string } | null;
  readonly scrub?: Scrubber;
  readonly draftsDir?: string;
  readonly mediaDir?: string;
  /** AI 查證的取回器（P6-T004）。沒給就不能查證（503）：測試不會因為忘了注入而連到真的網路。 */
  readonly factCheckFetcher?: FactCheckFetcherFactory;
}
