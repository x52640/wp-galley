/** 前後端共用的 HTTP 契約：Agent 的輸出、待處理清單、配圖需求與候選圖。規則見 api.ts 開頭；前端與後端一律從 `api.ts` import。 */

import type { AgentProvider, ReviewItemState, ReviewItemType } from './api-enums.js';
import type { Revision } from './api-job.js';

// --- Agent 的輸出 -------------------------------------------------------------

export interface ReviewChange {
  readonly type: 'typo' | 'grammar' | 'clarity' | 'style';
  readonly before: string;
  readonly after: string;
  readonly reason: string;
  /** Agent 自評有沒有改變原意。true 者 UI 必須標紅並預設不套用。 */
  readonly meaningChanged: boolean;
}

/** 需要人判斷的觀察。不是可以自動套用的改動。 */
export interface Observation {
  readonly kind: 'contradiction' | 'unsupported-claim' | 'missing-source' | 'gap';
  /** 對應正文第幾個頂層區塊，讓 UI 把它掛到那一段。 */
  readonly blockIndex: number;
  /** 原文中被指涉的片段，用來標亮。 */
  readonly excerpt: string;
  readonly detail: string;
  /** 建議怎麼處理；**不是**自動套用的改動。 */
  readonly suggestion: string;
}

/**
 * Agent 交回來的一條配圖需求，**還沒存進資料庫**，所以沒有 id。
 * 存進去之後的樣子是 `ImageBrief`。
 */
export interface ImageBriefDraft {
  /** 供 templateData 的 featuredImageBriefKey 指向。 */
  readonly key: string;
  readonly purpose: string;
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly altText: string;
  readonly caption?: string;
  /** 建議插入的位置描述，例如「第三段之後」。給人看的，不拿來定位。 */
  readonly placement?: string;
  /**
   * 錨點：這張圖要跟在後面的那一段裡的一小段**原文**（P5-T016）。後端拿它在目前這一版裡
   * 定位，不存段落編號。封面沒有錨點。
   */
  readonly anchor?: string;
}

// --- 待處理清單 --------------------------------------------------------------

/**
 * 清單上的一項。
 *
 * 校稿改動與觀察不是同一種東西（一個可以自動套用，一個只能請人判斷），但都是
 * 「掛在文章某一段上的待辦事項」，所以裝在同一個容器裡
 * （docs/specs/review-proposals.md「統一模型」）。
 */
export interface ReviewItem {
  readonly id: number;
  readonly ordinal: number;
  readonly type: ReviewItemType;
  readonly state: ReviewItemState;
  /** `type === 'change'` 時才有。 */
  readonly change: ReviewChange | null;
  /** `type === 'observation'` 時才有。 */
  readonly observation: Observation | null;
  /**
   * 掛在正文第幾個頂層區塊上。**每次讀取時重算**；定位不到就是 null，
   * 那一項就沒有「跳到該段」。
   */
  readonly blockIndex: number | null;
  /**
   * 後端在目前內容裡**實際找到**的那段字（P5-T037），跟 `blockIndex` 一起每次讀取時算。
   * change：套用前是 before、套用後（含已經改好了）是 after；觀察：原句找得到就是原句，找不到時用同一份校稿
   * 已落地的修改對應過的字（`excerptAfterChanges`）；都找不到是 null。畫面的字上標記與「去原文改」游標用它，
   * null 時退回原本引用的字。
   */
  readonly locatedText: string | null;
  readonly resolvedAt: string | null;
  /** 使用者從這張卡片進去直接改文章、存檔時一起結案的（P5-T012）。畫面寫「自己改了」，不是「保留原文」。 */
  readonly resolvedByEdit: boolean;
  /**
   * 已經改好了（P5-T017）：原句在目前的內容裡找不到，但要改成的字已經在了。這時 `state` 是 `skipped`、
   * `resolvedAt` 是 null，畫面寫「已經改好了」。**每次讀取時照目前的內容算**，不存進資料庫：
   * 內容再被改回去（after 不見了），這一項就回到它原本的狀態。規則見 `isAlreadyDone`（review-apply.ts）。
   * 重判的對象是還沒處理的與按過「保留原文」的；已接受、「自己改了」不重判。
   */
  readonly alreadyDone: boolean;
}

export interface ReviewProposal {
  readonly id: number;
  readonly provider: string;
  readonly summary: string | null;
  readonly createdAt: string;
  /** 這份提案是對著哪一份內容做的。 */
  readonly baseContentHash: string;
  /** 提案之後內容又被改過。逐項套用還能試，「全部接受」會被後端擋下。 */
  readonly stale: boolean;
  /** 還沒有下場的項目數：`pending` 加上 `unappliable`（已經改好了的不算）。 */
  readonly pendingCount: number;
  readonly items: ReviewItem[];
}

export interface ReviewResolveResult {
  /** 有東西真的被套用才會產生新版本；只是略過的話是 null。 */
  readonly revision: Revision | null;
  readonly applied: number[];
  readonly skipped: number[];
  /** 想套用但在目前內容裡定位不到。這幾項得使用者自己改。 */
  readonly unappliable: number[];
  /** 想套用，但文章裡已經是改好的樣子（P5-T017）。不建版本，清單上顯示「已經改好了」。 */
  readonly alreadyDone: number[];
  readonly review: ReviewProposal | null;
}

/**
 * 存進資料庫的一條配圖需求。**這裡不生圖**，只把「該配什麼圖」講清楚；
 * 使用者生完圖回來上傳時帶 `key`，就對回這一條。
 */
export interface ImageBrief {
  readonly id: number;
  readonly key: string;
  readonly purpose: string;
  /** 拿去貼進生圖工具的那段文字。 */
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly altText: string;
  readonly caption: string | null;
  /** Agent 講的位置描述（「第三段之後」）。**不是**區塊索引。 */
  readonly placement: string | null;
  /**
   * 錨點：圖要跟在後面的那一段的原文片段（P5-T016）。上傳後後端用它自動放進正文。
   * 封面、舊的配圖需求是 null。
   */
  readonly anchor: string | null;
  /** 已經有圖對上這條需求了。 */
  readonly fulfilled: boolean;
  readonly dismissed: boolean;
  readonly createdAt: string;
  /**
   * 這條是精選圖片（封面）的需求。判斷規則在後端（templateData 的
   * `featuredImageBriefKey`、key 以 `featured`／`cover` 開頭、placement 寫「精選」「封面」）。
   * 對上這條的圖上傳之後會自動設成精選。
   */
  readonly isFeatured: boolean;
  /** 最新一張還沒用掉的生成候選圖；沒有就是 null。**還沒上傳到 WordPress。** */
  readonly candidate: ImageCandidate | null;
  /**
   * 誰發起的（P5-T018）：`agent`＝一鍵配圖／校稿給的建議；`user`＝使用者在文章上「在這裡插圖」→
   * 「請 AI 配一張」。`user` 那條的 key 以 `user-` 開頭、永遠不是封面，`prompt` 是系統組好的整份生圖指令。
   */
  readonly origin: 'agent' | 'user';
  /** 圖放在錨點那段之後（`after`）或之前（`before`，只有文章最前面那個位置會用到）。 */
  readonly anchorPosition: 'after' | 'before';
  /** 使用者那句「想要什麼樣的圖」（選填）；Agent 的建議是 null。 */
  readonly note: string | null;
  /**
   * 使用者在卡片上改過這條的畫面描述（D-027，P5-T027）。之後任何一趟 Agent 回同一個 key，描述都保留使用者的版本。
   * 只有 Agent 那條（`origin = 'agent'`）可能是 true；使用者那條改的是 `note`，永遠是 false。
   */
  readonly promptEdited: boolean;
  /**
   * 使用者選一段文字「用此段配圖」建的（D-037，P5-T038）：卡片上的依據寫在 `purpose`
   * （「依選取段落：『…』（共 N 字）」）。在卡片上改那句話時只換使用者的希望，選取段落不變。
   */
  readonly fromSelection: boolean;
}

/**
 * Codex 生出來、只存在本機的候選圖（D-017）。按「用這張」才會上傳到 WordPress
 * 媒體庫；不用它就一直留在本機。**不是內容改動，不會讓核准失效。**
 */
export interface ImageCandidate {
  readonly id: number;
  readonly briefId: number;
  /** 本機 API 的網址（`/api/jobs/:uuid/candidates/:id`），不是 WordPress 的網址。 */
  readonly url: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly createdAt: string;
}

/** 現在能不能生圖。只有 Codex 能生圖；沒裝、沒登入就是 false，`reason` 講為什麼。 */
export interface ImageGenerationStatus {
  readonly available: boolean;
  /** 負責生圖的 Agent；一家都不支援時是 null。 */
  readonly provider: AgentProvider | null;
  readonly reason: string | null;
}
