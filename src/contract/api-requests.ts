/** 前後端共用的 HTTP 契約：HTTP 請求本體。規則見 api.ts 開頭；前端與後端一律從 `api.ts` import。 */

import type { AgentProvider, AgentTask, PublishStatus, RevisionOrigin } from './api-enums.js';
import type { ImageBrief } from './api-review.js';

// --- 請求 --------------------------------------------------------------------

export interface CreateJobRequest {
  readonly targetKey: string;
  /** 可以是空的（P5-T029）：正文存成一個空段落，建立後直接在文章上寫。 */
  readonly sourceText: string;
  readonly title?: string;
  /** 已經有結構化資料就直接給；沒給就由 sourceText 決定性地轉成段落。 */
  readonly templateData?: Record<string, unknown>;
}

export interface CreateRevisionRequest {
  readonly origin?: RevisionOrigin;
  /** 整份取代目前的 templateData；沒給就沿用上一版。 */
  readonly templateData?: Record<string, unknown>;
  /**
   * 直接在文章上改（P5-T010）：只換正文，其他欄位沿用上一版。後端先整理瀏覽器
   * 編輯器產生的雜訊再渲染。不能跟 `templateData` 同時給。
   */
  readonly editedBody?: string;
  /**
   * 從哪張建議卡片進去改的（P5-T012）。存成新版本時那一項一起標成已處理（`resolvedByEdit`）；
   * 沒有實質改動就不動它。只能跟 `editedBody` 或 `editedTitle` 一起用（講標題的建議只改標題也算，P5-T031）。
   */
  readonly resolveItemId?: number;
  /**
   * 從哪張查證卡片「去原文改」進來的（D-034，P6-T004）。規則同 `resolveItemId`：存成新版本時那條查證結果
   * 標成 `resolved-by-edit`；沒有實質改動就不動它。只能跟 `editedBody` 或 `editedTitle` 一起用。
   */
  readonly resolveFactCheckId?: number;
  /**
   * 在文章上直接改的標題（P5-T029）：只換 `title`，其他欄位沿用上一版；可以單獨給，也可以跟
   * `editedBody` 一起給（存成同一個新版本）。純文字、一行、不能是空的（`contract/plain-title.ts`）。
   * 不能跟 `templateData` 同時給。
   */
  readonly editedTitle?: string;
  readonly sourceText?: string;
  /** `null` 代表清除精選圖片；不給代表沿用。 */
  readonly featuredMediaId?: number | null;
  /** 稽核用的說明，也會寫進核准撤銷的理由。 */
  readonly reason?: string;
  /**
   * 這次編輯是根據哪一版算出來的（那一版的 `contentHash`，P5-T005）。
   *
   * `templateData` 是整份取代，兩個面板各自送出時，晚到的那一份會把先到的欄位蓋掉。
   * 帶上這個值，目前版本不是它就回 409 `CONTENT_CHANGED`，什麼都不寫。不給就不檢查。
   */
  readonly expectedContentHash?: string;
}

export interface AgentRunRequest {
  readonly provider: AgentProvider;
  /** 預設 `review`。 */
  readonly task?: AgentTask;
  readonly model?: string;
  /** 使用者在聊天框打的字。不受信任內容，會被明確標示邊界。 */
  readonly instruction?: string;
  readonly timeoutMs?: number;
}

/**
 * AI 建議英文網址（D-026，P5-T026，`POST /api/jobs/:uuid/slug-suggestions`）。
 *
 * 只收「交給哪一家」：輸入一律是後端**目前這一版**的標題＋內文開頭，前端給不了別的內容。
 */
export interface SlugSuggestionRequest {
  readonly provider: AgentProvider;
  readonly model?: string;
  readonly timeoutMs?: number;
}

/**
 * 建議的網址。`slugs` 已經過後端篩選（`contract/slug.ts`：小寫英數與單個連字號、上限 60），
 * 最多三個、至少一個（一個都不合格時回 502，不會是空陣列）。`dropped` 是格式不合格被丟掉的個數。
 * **不會自動填進文章**：使用者點了才填進網址欄，照原本的「儲存」存。
 */
export interface SlugSuggestionResponse {
  readonly slugs: string[];
  readonly dropped: number;
}

/** 圖片走 base64 JSON 而不是 multipart，理由見 src/server/routes/jobs.ts。 */
export interface MediaUploadRequest {
  readonly filename: string;
  readonly mimeType: string;
  readonly dataBase64: string;
  readonly altText?: string;
  readonly caption?: string;
  readonly briefKey?: string;
}

export interface PlaceMediaRequest {
  readonly afterBlockIndex: number;
}

/**
 * 在文章上「請 AI 配一張」（P5-T018，`POST /api/jobs/:uuid/briefs`）。
 *
 * 只收位置與使用者那句話；prompt 由後端用固定程式組（前後段落＋那句話＋固定約束），前端給不了。
 * `contentHash` 是畫面上那一版：位置是照它數的，後端的目前版本不是它就拒絕（409），不然會指到別段。
 */
export interface ImageAtPositionRequest {
  /** 插在第幾個頂層區塊之後；-1＝最前面。跟 `PlaceMediaRequest` 同一套索引。 */
  readonly afterBlockIndex: number;
  readonly contentHash: string;
  /** 想要什麼樣的圖，一句話，選填。上限 200 字：摺疊空白之後數 code point（`contract/user-note.ts`）。 */
  readonly note?: string;
}

/**
 * 選一段文字「用此段配圖」（D-037，P5-T038，同一條 `POST /api/jobs/:uuid/briefs`，跟 `ImageAtPositionRequest` 二選一）。
 *
 * 後端用目前這一版重新定位選取（忽略空白、可跨段）；找不到、出現不只一次都 400。prompt 由後端組。
 */
export interface ImageFromSelectionRequest {
  /** 選的字（純文字，`Selection.toString()`）。10～3000 字（`contract/selection-image.ts`），超過不截斷。 */
  readonly selection: string;
  /**
   * 圖放哪裡（`selectionSpots`）：0＝這段開頭（預設）、1..n-1＝選取範圍內第 k 段有字的段落之後、n＝這段結尾。
   * 只影響放哪，不影響 prompt。
   */
  readonly spot?: number;
  /**
   * 畫面上看到的位置個數（含開頭、結尾）。後端用目前這一版算的個數不一樣（打字模式存檔整理改了段落）就 400，不猜。
   * 畫面上定位不到選取時不送。
   */
  readonly spotCount?: number;
  /**
   * 畫面上所選位置兩側的字（`spotEdges`：前面那塊結尾、後面那塊開頭，各取忽略空白後 20 字；最前面／最後面那側是空字串）。
   * 跟後端用目前這一版算的不一樣（段落被拆開或合併，邊界挪了）就 400，不猜。畫面上定位不到選取時不送。
   */
  readonly spotBefore?: string;
  readonly spotAfter?: string;
  readonly contentHash: string;
  readonly note?: string;
}

/**
 * 在卡片上改配圖需求（D-025，P5-T025，`PATCH /api/jobs/:uuid/briefs/:id`）。**只能送其中一個**：
 * - `prompt`：Agent 建議的那條（`origin = 'agent'`，含封面）的畫面描述。去頭尾後不能是空的，
 *   上限 2000 字（code point，`contract/brief-prompt.ts`）。
 * - `note`：使用者發起的那條（`origin = 'user'`）的「想要：…」那句；空的＝沒有特別要求。上限 200 字
 *   （`contract/user-note.ts`）。整份生圖指令由後端用目前的內容重組，前端給不了。
 */
export interface UpdateImageBriefRequest {
  readonly prompt?: string;
  readonly note?: string;
}

/**
 * `PATCH /api/jobs/:uuid/briefs/:id`：更新後的那條需求。
 * `notice`：存了，但有一件事要讓使用者知道（使用者那條的錨點在目前的文章裡對不上，前後段落沿用當初的）；
 * 沒事是 null。
 */
export interface UpdateImageBriefResponse {
  readonly brief: ImageBrief;
  readonly notice: string | null;
}

/**
 * 「用這張」（`POST /api/jobs/:uuid/candidates/:id/use`）可以帶的東西。body 可以整個不給（舊前端）。
 * `altText`：卡片上填的替代文字（P5-T018，使用者在文章上請 AI 配的那條預設是空的），沒給就用需求上的。
 */
export interface UseCandidateRequest {
  readonly altText?: string;
}

export interface ResolveReviewRequest {
  readonly itemIds: number[];
  readonly decision: 'apply' | 'skip';
}

/** 整份操作要指名是哪一份提案，理由見 ReviewProposal 的說明。 */
export interface ProposalRefRequest {
  readonly proposalId?: number;
}

export interface DiscardReviewRequest {
  readonly reason?: string;
  readonly proposalId?: number;
}

export interface ApproveRequest {
  readonly contentHash: string;
}

export interface RevokeApprovalRequest {
  readonly reason?: string;
}

export interface PublishRequest {
  readonly status: PublishStatus;
  /** requireSecondConfirmation 的 target 需要 UI 再確認一次。 */
  readonly confirm?: boolean;
  /**
   * 這一篇的作者（P5-T024）。跟 status 一樣是**發布選項**，不是核准的內容：改它不讓核准失效。
   * 不給就用站台設定的預設作者，都沒有就不送。後端驗證它在站上可當作者的名單裡。
   */
  readonly authorId?: number;
}

/** `POST /api/setup/default-author`：把這個站的預設作者寫進站台設定檔。null＝清掉。 */
export interface SetDefaultAuthorRequest {
  readonly authorId: number | null;
}

export interface CreateTermRequest {
  readonly taxonomy: string;
  readonly name: string;
}
