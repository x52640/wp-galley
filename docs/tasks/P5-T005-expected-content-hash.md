---
id: P5-T005
phase: 5
status: ready
depends_on: [P5-T002]
specs: [state-machine.md, http-api.md]
write_paths: ["src/contract/api.ts", "src/core/service.ts", "src/server/routes/jobs.ts", "src/ui/service/types.ts", "tests/", "docs/specs/http-api.md"]
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
- [ ] 帶錯 hash 會 409，帶對的或不帶都照舊
- [ ] 409 時畫面有可理解的訊息（重新載入後再改）

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：先寫失敗的測試
- Blocker：無

## 完成結果
