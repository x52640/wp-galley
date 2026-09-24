---
id: P5-T005
phase: 5
status: done
depends_on: [P5-T002]
specs: [state-machine.md, http-api.md]
write_paths: ["src/contract/api.ts", "src/core/service.ts", "src/server/routes/jobs.ts", "src/ui/service/types.ts", "src/ui/components/Workspace.tsx", "tests/", "docs/specs/http-api.md"]
contract_change: additive
expected_commit: "fix(P5-T005): 建立 revision 時檢查 expectedContentHash"
---

# 建立 revision 時真的檢查 expectedContentHash

## 目標
P5-T002 發現：前端（`SourcePanel`、`TaxonomyPanel`）送出整份 `templateData` 時會帶
`expectedContentHash`，註解說「後端對不上就拒絕，不會默默覆蓋」。**後端沒有實作**，
zod 直接把欄位丟掉。兩個面板先後送出時，晚到的那一份會蓋掉先到的欄位，沒有任何提示。

## 範圍
### 包含
- 契約 `CreateRevisionRequest` 加 `expectedContentHash?`；路由 schema 加欄位
- `createRevision` 在寫入前比對目前 revision 的 hash，不符丟 `ContentChangedError`（409）
- 前端 `types.ts` 拿掉臨時的擴充型別
### 不包含
- 其他寫入路徑（placeMedia 等）的同類檢查——需要的話另開

## 驗證命令
`npm run verify`

## 完成定義
- [x] 帶錯 hash 會 409，帶對的或不帶都照舊
- [x] 409 時畫面有可理解的訊息（重新載入後再改）

## 中斷／接手紀錄
- 最後完成：契約、路由、CoreService 檢查、前端型別、http-api.md、測試全部完成
- 已通過驗證：`npm run verify` 52 檔／923 測試全綠（基準 51／914，新增 1 檔 9 測試）
- 下一步：無（獨立審查無真問題，已 commit）
- Blocker：無

## 完成結果
- `CreateRevisionRequest.expectedContentHash?`（契約）；路由 zod 收 64 位十六進位，格式錯 400，往下傳給 CoreService。
- `createRevision` 讀到目前 revision 後、任何寫入（含撤銷核准）之前比對，不符丟既有的
  `ContentChangedError`（→ 409 `CONTENT_CHANGED`）。整段是同步的（`DatabaseSync`、沒有 await），
  比對與寫入之間沒有空窗，所以沒另開 transaction。
- 前端 `types.ts` 拿掉臨時擴充，`CreateRevisionInput` 直接等於契約型別。
- 409 時的畫面：兩個面板經 `guardEdit`（`src/ui/components/panels/shared.tsx`）換成
  `REVISION_CONFLICT_MESSAGE`；直接在文章上改（`Workspace.tsx` → `ProofView.tsx` 的 `saveEdit`）顯示
  「沒存成功：」＋後端訊息，後端訊息本身就說明「沒存進去、沒蓋掉、重新讀取再改」。UI 元件不用改。
- 新測試：`tests/expected-content-hash.test.ts`（核心 5、HTTP 4）。
- `Workspace.tsx` 過時註解已更新（審查後把該檔加入 write_paths，只改註解）。
- 已知小尾巴：直接在文章上改遇到 409 後按「重新讀取」，編輯框裡未存的字可能消失（未處理）。
