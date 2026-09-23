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

送出時只送允許變更的欄位，不順便覆蓋未知的 meta；建立或更新後記錄遠端快照
（hash、modified time、內容），供下一次更新比對。
