/** 前後端共用的 HTTP 契約：首次設定精靈（P8-T002，D-016）。規則見 api.ts 開頭；前端與後端一律從 `api.ts` import。 */

import type { AgentProvider } from './api-enums.js';
import type { PublishTargetSummary } from './api-job.js';

// --- 首次設定精靈（P8-T002，D-016）---------------------------------------------
//
// 規則在 docs/specs/security.md「設定精靈寫入的秘密」與 wordpress-site.md「設定精靈」。
// **任何回應都不含 Application Password**，連長度與遮蔽過的樣子都沒有。

/** `GET /api/setup`：要不要跑精靈、目前設定了什麼。 */
export interface SetupStatus {
  /** 沒有 WordPress 連線或沒有站台設定檔：畫面自動進精靈。 */
  readonly needsSetup: boolean;
  /** 已設定的連線（只有網址與帳號）。 */
  readonly wordpress: { readonly url: string; readonly username: string } | null;
  /** 本機站台設定檔（`config/publish-targets.json`）目前的內容。 */
  readonly siteConfig: { readonly exists: boolean; readonly targets: PublishTargetSummary[] };
  /** 這個後端能不能寫設定（測試或特殊啟動方式沒給檔案路徑時是 false）。 */
  readonly canWrite: boolean;
}

export interface SetupConnectionRequest {
  readonly url: string;
  readonly username: string;
  /** 只在這一個請求出現。有沒有空白都可以。 */
  readonly appPassword: string;
}

/**
 * 連線失敗的種類。畫面照它挑圖示與排版；文字（title／detail／next）一律由後端給，照抄。
 */
export type SetupProblemKind =
  | 'invalid-url'
  | 'not-https'
  | 'password-format'
  | 'unreachable'
  | 'redirect'
  | 'not-wordpress'
  | 'rest-blocked'
  | 'app-passwords-disabled'
  | 'auth-header-stripped'
  | 'wrong-username'
  | 'wrong-password'
  | 'no-permission'
  | 'types-missing'
  | 'server-error';

export interface SetupProblem {
  readonly kind: SetupProblemKind;
  /** 一句話：發生什麼事。 */
  readonly title: string;
  /** 為什麼會這樣（白話）。 */
  readonly detail: string;
  /** 下一步該做什麼。 */
  readonly next: string;
}

/** 檢查清單的一列：畫面照順序列出「過了哪幾關、卡在哪一關」。 */
export interface SetupCheck {
  readonly key: 'https' | 'reachable' | 'rest' | 'auth' | 'permission' | 'types';
  readonly label: string;
  readonly state: 'ok' | 'fail' | 'warn' | 'skipped';
}

export interface SetupConnectionResult {
  readonly ok: boolean;
  /** 整理過的網址（補 https、去掉結尾的 /wp-admin 等）；網址本身不合法時是 null。 */
  readonly url: string | null;
  readonly checks: SetupCheck[];
  readonly problem: SetupProblem | null;
  /** 不擋存檔的提醒，例如 administrator 權限過大、不能上傳圖片。 */
  readonly warnings: string[];
  readonly identity: { readonly name: string; readonly slug: string; readonly roles: string[] } | null;
  /** 測試通過才有；「儲存」只送這個，密碼不再過網路。10 分鐘內有效。 */
  readonly testId: string | null;
  /**
   * 測試的是**另一個站**，而目前這個站上已經發過文或傳過圖：存之前要讓使用者知道哪些不會跟過去。
   * 沒換站、或舊站上什麼都沒有時是 null。
   */
  readonly siteChange: SetupSiteChange | null;
}

export interface SetupSiteChange {
  readonly from: string;
  readonly to: string;
  /** 發布到舊站的稿件數。換過去之後不能再從發布台更新它們。 */
  readonly publishedJobs: number;
  /** 傳到舊站媒體庫的圖片數。新站用不到，要重新上傳。 */
  readonly uploadedMedia: number;
}

export interface SetupSaveWordPressRequest {
  readonly testId: string;
  /** 測試結果帶 `siteChange` 時必須是 true，否則 409。 */
  readonly confirmSiteChange?: boolean | undefined;
}

export interface SetupSaveResponse {
  readonly saved: true;
  /**
   * 需不需要重新啟動發布台才生效。目前一律 false：連線、發布目標與遮蔽器都當場換掉。
   * 留著欄位是讓畫面照後端講的做，不自己猜。
   */
  readonly restartRequired: boolean;
  /** 改寫站台設定檔前留的備份（相對專案根目錄）；沒有覆寫既有檔就是 null。 */
  readonly backupFile: string | null;
  readonly status: SetupStatus;
}

/** 精靈第二步的一列。安裝與登入指令由後端給，使用者自己到終端機執行。 */
export interface SetupAgent {
  readonly id: AgentProvider;
  readonly displayName: string;
  readonly installed: boolean;
  readonly version: string | null;
  readonly loginState: 'logged-in' | 'logged-out' | 'unknown';
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** 只有 Codex 能生圖（D-017）。 */
  readonly canGenerateImages: boolean;
  readonly installCommand: string;
  readonly loginCommand: string;
  /** 安裝說明的補充（例如要先裝什麼）；沒有是 null。 */
  readonly installNote: string | null;
}

export interface SetupAgentsResponse {
  readonly agents: SetupAgent[];
}

/** 精靈第三步能選的目的地。第一版只有核心的文章與頁面（D-016）。 */
export type SetupDestinationKey = 'post' | 'page';

export interface SetupDestinationOption {
  readonly key: SetupDestinationKey;
  readonly displayName: string;
  readonly postType: string;
  /** 站上有沒有開放這個類型的 REST，帳號能不能發。 */
  readonly available: boolean;
  /** 不能選的原因與下一步。 */
  readonly reason: string | null;
  readonly restBase: string | null;
  readonly taxonomy: string | null;
  /** 站上 `/wp/v2/taxonomies` 回報的 rest_base（核心 category 是 categories）。 */
  readonly taxonomyRestBase: string | null;
  /** 設定檔裡已經有同一個 key 的目標：要取代得明確勾選。 */
  readonly existing: PublishTargetSummary | null;
}

export interface SetupDestinationsResponse {
  readonly options: SetupDestinationOption[];
  /** 設定檔裡現有的全部目標（例如作者站台的長文與日記），含停用的。精靈不會刪它們，只能停用／打開。 */
  readonly existing: PublishTargetSummary[];
  /**
   * 每個類型還有幾篇進行中的稿件（沒發布、沒取消）。停用時畫面講「還有 N 篇，停用後照常可以編輯」。
   * 沒有稿件的 key 不列（P5-T032）。
   */
  readonly openJobs: Record<string, number>;
}

export interface SetupDestinationsRequest {
  /** 要加入的文章／頁面。可以是空的（只改停用），但這時一定要給 `disabled`。 */
  readonly include: SetupDestinationKey[];
  /** 已經存在、要被取代的 key。沒列在這裡又已經存在的，整個請求拒絕。 */
  readonly replace: SetupDestinationKey[];
  /**
   * 存完之後**停用的完整清單**（設定檔裡的 target key，P5-T032）。不在清單裡的一律啟用；
   * 不給＝停用狀態不動。全部停用、或有設定檔裡沒有的 key，整個請求 400、檔案不動。
   */
  readonly disabled?: string[] | undefined;
}
