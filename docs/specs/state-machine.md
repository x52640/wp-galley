# 狀態機與核准

> 擁有範圍：job 狀態轉移、核准的建立與失效、發布前置檢查。
> 程式：`src/core/state-machine.ts`、`src/core/service.ts`（approve / revoke / publish）、
> `src/core/content-hash.ts`。
> 為什麼核准只能由 UI 建立：見 [security.md](security.md)。

## 不可妥協的規則

1. **revision 不可變。** 每次修改都建立新 revision，以 canonical content 算 `content_hash`
   （`src/core/content-hash.ts`）。
2. **核准綁定 revision 的 `content_hash`，內容一改就失效。** 建立 approval 時記下
   當時的 hash；任何會改變內容的操作都要把現有 approval 撤銷（`revoked_at`），
   並把 job 退回 `RENDERED`。這件事在 **CoreService 裡做**，不是在路由或 UI。
3. **只有本機 UI 能建立 approval。** DB 的 `approvals.created_by` 有
   `CHECK (created_by = 'ui')`，CoreService 也要再擋一次。MCP 呼叫同一個 CoreService，
   但不得呼叫核准相關的方法。（本檔是這條規則的家；其他檔只連結。）
4. **校稿只會把 `SOURCE` 推進 `REVIEWED`。** 轉移表允許 `RENDERED → REVIEWED`，
   但那條邊是給「內容真的改了」用的；提案制之下拿來用會把一篇已經渲染好的稿子推回
   「還沒渲染」，多出一條假的 blocker，而校樣其實一點都沒失效。

## 狀態轉移

```
SOURCE → REVIEWED → MEDIA_READY → RENDERED → PREVIEWED → APPROVED → PUBLISHING → PUBLISHED
                                     ↑                        │
                                     └────────────────────────┘
                                     內容一改，核准失效，退回 RENDERED
```

另外三個終止狀態：`FAILED`、`CANCELLED`、`SUPERSEDED`。

允許的轉移寫在 `src/core/state-machine.ts`，用表格定義，不要散在各處的 if。
不在表格裡的轉移一律丟 `InvalidTransitionError`。

| 目前狀態 | 允許轉移到 |
| --- | --- |
| `SOURCE` | `REVIEWED`、`RENDERED`、`CANCELLED`、`FAILED` |
| `REVIEWED` | `MEDIA_READY`、`RENDERED`、`CANCELLED`、`FAILED` |
| `MEDIA_READY` | `RENDERED`、`CANCELLED`、`FAILED` |
| `RENDERED` | `PREVIEWED`、`REVIEWED`、`MEDIA_READY`、`CANCELLED`、`FAILED` |
| `PREVIEWED` | `APPROVED`、`RENDERED`、`CANCELLED`、`FAILED` |
| `APPROVED` | `PUBLISHING`、`RENDERED`（核准失效）、`CANCELLED` |
| `PUBLISHING` | `PUBLISHED`、`FAILED` |
| `PUBLISHED` | `SUPERSEDED` |

**`SOURCE → RENDERED` 是刻意留的**：使用者可以完全不用 Agent，貼完稿直接渲染發布。

## 核准失效的實作點

`createRevision`、`placeMedia`、`setFeaturedMedia`、`replaceMedia` 這些會改變
`content_hash` 的方法，**在寫入前**一律：

1. 找出這個 job 尚未撤銷的 approval
2. 若存在，設 `revoked_at` 與 `revoke_reason`
3. 若 job 狀態是 `APPROVED`，退回 `RENDERED`
4. 寫一筆 `publish_events`（`event_type: 'approval_revoked'`）

**不要靠呼叫端記得做這件事。**

不在這份清單上的：`addMedia`（上傳本身不改正文）與 Codex 生圖的候選圖（只存本機，D-017）。
對上封面那條配圖需求、而且沒有使用者選的別張封面時，上傳會接著呼叫 `setFeaturedMedia`，核准因此照上面的規則失效。

## publish 的前置檢查

`publish` 必須依序檢查，任一項失敗就丟出對應錯誤且**不送任何請求**：

1. job 狀態是 `APPROVED`
2. 有未撤銷的 approval，且 `approval.content_hash === 目前 revision 的 content_hash`
3. target 的 `allowCreate` / `allowUpdate` 允許這次操作
4. `requireFeaturedImage` 的 target 有設精選圖片
5. 更新既有文章時，遠端沒被改過（`assertUnchanged`，比對上次記錄的遠端快照）。
   目前沒有「修改已發布文章」的路徑，這條檢查備而不用，見 `plan.md` Q-5。
6. 更新既有文章時，遠端那篇必須是草稿——**不論使用者選草稿或公開**；已公開、排程（`future`）、
   私人等非草稿狀態一律拒絕、零寫入：「這篇在站上已經是 <狀態>，發布台目前不支援修改已公開的文章
   （待裁定 Q-5）」（P5-T022，審查 #1；2026-09-24 裁定）。那條路就是「修改已發布文章」；而且 WordPress
   的更新不帶 status 就維持原狀態，不擋的話「存成草稿」會直接改到線上內容。
   目前只有 target 設了 `fixedObjectId` 才走得到。
7. 這篇沒有圖片正在上傳或替換（P5-T022，審查 #3）。換圖一開始就撤銷核准、然後等上傳；
   等待期間重新核准再發布，發出去的是舊圖，回來的上傳卻要改本機紀錄。

讀遠端（第 5 項）要等網路，讀完後第 1–4 項重跑一次，版本或核准變了就中止。

### PUBLISHING 期間核准被撤銷（P5-T022，審查 #2）

`revokeApproval` 不看工作狀態，PUBLISHING 期間也撤得掉。進 PUBLISHING 之後還有兩個等網路的點
（查分類、建／改草稿），所以：

- **每一個寫入請求送出前**同步確認建立發布時的那張核准仍有效（沒被撤銷、沒被換掉），檢查與送出之間
  沒有 await。建新稿前直接檢查；`updateDraft`、`setStatus` 內部會先讀遠端再寫，所以檢查放在它們的
  `beforeWrite` 回呼（讀回遠端之後、送出寫入之前），不是呼叫它們之前。
- 草稿還沒寫就失效：一個寫入都不送。
- 草稿寫了、改公開前失效：不改成公開，WordPress 上那篇維持寫進去時的狀態（依回傳的狀態寫，目前一定是草稿）。

兩種都是 `PUBLISHING → FAILED`，記 `publish`／`failed` 事件，錯誤講清楚有沒有送出、那篇停在什麼狀態（第 N 號）。
落在 `FAILED` 是因為 PUBLISHING 只能到 `PUBLISHED` 或 `FAILED`，而 `PUBLISHED` 代表照核准發出去了，
這裡不是。跟其他發布途中出錯一樣，那篇草稿不記進 `wordpress_objects`（錯誤訊息與事件裡有編號）。

## 發布選項（不算核准的內容）

發布請求裡的 `status`（草稿／公開）與 `authorId`（作者，P5-T024，D-024；2026-09-24 使用者同意）是**發布選項**：
不進 `content_hash`、改了不讓核准失效，同一張核准可以換著試。

作者怎麼決定（`resolvePublishAuthor`，在第一次前置檢查之後、讀遠端之前）：

1. 請求有 `authorId` 用它；沒有用站台設定檔的 `defaultAuthorId`；都沒有就**不送 author、也不問站台**（原本的行為）。
2. 要送的話問站台誰可以當作者（規則見 [wordpress-site.md](wordpress-site.md)「作者」）：
   - 在名單裡 → 送。
   - 帳號能指定別人、但這個 id 不在名單 → 拒絕（`publish`／`rejected` 事件、`PUBLISH_BLOCKED`），零寫入，工作維持 `APPROVED`。
     預設作者不在名單（換過站）也拒絕，請使用者重選——不默默改用發布台的帳號。
   - 帳號只能用自己（capabilities 確定沒有 edit_others_posts）：請求指定別人 → 拒絕；只是預設作者是別人 → 不送（反正只能是自己，面板已經講了）。
   - **讀不到清單**（被擋、限流、連不上）→ 拒絕（`rejected` 事件），零寫入，工作維持 `APPROVED`。不當成「只能用自己」，
     否則作者會靜默變成發布台的帳號。
   - 等清單的期間核准被撤銷：後面的第二次前置檢查與寫入前的核准確認會擋下，零寫入。
3. 完成畫面寫出作者；沒送 author 時寫「作者是發布台的帳號（名字）」。
4. 實際送出的作者 id 記在 `publish` 的 `started` 與 `succeeded` 事件（`authorId`，沒送是 null），也回在 `PublishResult.author`。

送出時只送允許變更的欄位，不順便覆蓋未知的 meta；建立或更新後記錄遠端快照
（hash、modified time、內容），供下一次更新比對。更新時送哪些欄位見
[wordpress-site.md](wordpress-site.md)「更新既有文章」。
