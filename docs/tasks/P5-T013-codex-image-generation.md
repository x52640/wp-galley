---
id: P5-T013
phase: 5
status: done
depends_on: []
specs: [agent-cli.md, agent-tasks.md, security.md, state-machine.md, http-api.md, core-service.md, design-system.md, testing.md]
write_paths: ["src/agents/", "src/core/", "src/contract/api.ts", "src/server/routes/", "src/media/", "src/db/migrations/", "src/config/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T013): 用 Codex 訂閱生圖"
---

# 用 Codex 訂閱生圖

## 目標
D-017。配圖卡片現在只能「複製 prompt」拿去別處生圖，違反 D-008（不准離開發布台）。
Q-6 實測證明 Codex CLI 用訂閱就能生圖（見 `docs/specs/agent-cli.md`「Codex 生圖」）。

## 範圍
### 包含
- 配圖卡片（`src/ui/components/panels/MediaPanel.tsx` 的 BriefCard）加「用 Codex 生圖」。
  Codex 沒裝／沒登入時不給按，並說明原因（只有 Codex 能生圖）。
- 後端呼叫 `codex exec --json --skip-git-repo-check -C <job workspace> -s read-only "<prompt>"`：
  - 從第一個 `thread.started` 事件拿 `thread_id`，結束後去 `$CODEX_HOME`（預設 `~/.codex`）
    `/generated_images/<thread_id>/` 拿圖。**不要**叫 Codex 把圖複製到工作目錄（那需要寫入權限）。
  - 拿到的檔案先過既有的圖片驗證（`src/media/`），再存成本機候選圖（`generated-images/`，已 gitignore）。
  - prompt 由固定程式組：brief 的 prompt、比例、固定的「不要出現文字」等約束。
- 生圖是長時間動作：一次一個、可取消、有逾時；畫面用計時器與說明，**不畫假的進度條**（D-010）。
  跟校稿共用「同一篇稿件一次只能跑一個 Agent 動作」的規則。
- 候選圖顯示在卡片上（本機 API 送出，不上傳）。按鈕：「用這張」→ 上傳到 WordPress 媒體庫
  （走既有 addMedia，帶 briefKey、alt、caption）；「再生一張」；不滿意可以不用。
- 封面卡片（placement／key 表示精選圖片的那種，照現有資料判斷）上傳後**自動設成精選**；
  手動「上傳這張」也一樣。

### 不包含
- Claude／Antigravity 生圖（做不到）
- 圖片壓縮或轉檔（PNG 約 1.7 MB，WordPress 收得下）
- 修改圖片、局部重繪

## 實作要求
- **測試絕不呼叫真實 CLI、絕不連真實 WordPress**（CLAUDE.md、`docs/specs/testing.md`）。用假的 adapter／
  假的 generated_images 目錄。
- 不用 `shell: true`。Agent 維持 `read-only`；不握連外能力（D-009）。
- 生成的候選圖不算內容改動、不讓核准失效；「用這張」之後的上傳與設精選照既有規則處理。
- 先寫測試再實作。改了行為就更新擁有它的 spec（agent-cli、agent-tasks、http-api、core-service、design-system）。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證
示範資料模式（`?fixtures=1`）走完：生圖（假的）→ 看到候選圖 → 用這張 → 封面自動設精選。
真實 Codex 生圖與真實上傳**留給使用者**（耗額度、會寫進 WordPress 媒體庫）。

## 完成定義
- [x] `npm run verify` 綠（39 檔 / 603 測試）
- [x] 無頭 Chrome 走過示範資料流程
- [x] 相關 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作、測試、spec、示範資料走查；再依獨立審查修掉 9 項（2026-09-23，subagent）
- 已通過驗證：`npm run verify` 39 檔 / 603 測試；`?fixtures=1` 無頭走完生圖→候選圖→用這張→封面自動設精選，另走過停止（顯示「已停止」）、再生一張、已有封面時不覆蓋
- 下一步：使用者實測真實 Codex 生圖與真實上傳（耗額度、會寫進媒體庫）
- Blocker：無

## 完成結果

- 後端：`CodexAdapter.generateImage`（`src/agents/adapters/codex.ts`）照實測參數加 `-s read-only`，prompt 走 stdin，
  從 `$CODEX_HOME/generated_images/<thread_id>/` 拿圖；`AgentRegistry` 依 adapter 有沒有 `generateImage` 決定誰能生圖，
  跟校稿排同一條佇列。`CoreService.generateBriefImage`／`useImageCandidate`／`imageCandidateFile`／`imageGenerationStatus`。
- 資料：migration 005（`image_candidates` 表、`agent_runs.image_brief_id`）。候選圖存 `generated-images/<job>/candidates/`。
- 封面判斷：`src/core/image-generation.ts` 的 `isFeaturedBrief`（templateData 的 `featuredImageBriefKey`、key 以
  `featured`／`cover` 開頭、placement 寫「精選」「封面」）；`addMedia` 對上就自動設精選，手動上傳也一樣。
- 圖片驗證抽成 `src/media/validate.ts`（上傳行為不變；候選圖另外依檔頭認類型）。
- 契約（additive）：`ImageBrief.isFeatured`／`candidate`、`ImageCandidate`、`ImageGenerationStatus`、`AgentRunTask`、
  `AgentRun.briefId`、`ImageCandidateResponse`。
- 順手修：`agent_runs.started_at` 是沒寫時區的 UTC，前端當本地時間解析，台灣時區下計時器一直停在 00:00
  （既有的校稿長條也中）→ `parseServerTime`。
- 與 Task 文字的差異：Task 寫 prompt 當位置參數，實作走 stdin（security.md 優先）。
- 審查後修正：
  - 生圖加上 `--ephemeral`／`--ignore-user-config`（跟校稿一樣隔離使用者設定，D-009）。**這兩個參數沒有在
    真實生圖上驗證過**；找不到圖時訊息會寫明「在 generated_images/<thread> 找不到圖」。使用者第一次真實生圖就是驗證。
  - 封面判斷：templateData 有 `featuredImageBriefKey` 時只認它；placement 只看開頭（「精選圖片」「封面」）。
  - 自動設精選不覆蓋使用者選的封面（除非目前封面就是同一條需求的圖），結果回傳 `autoFeature`，畫面講出
    「已經有封面了」或失敗原因；手動上傳封面也提醒核准會失效。
  - 「用這張」先同步搶下候選圖，兩個同時送來只上傳一次，上傳失敗放回去。
  - 排隊中就被取消的生圖不叫 Codex；生圖期間需求被標成不要了就不收；需求重新提過之後舊候選圖不顯示也不能用；
    讀圖時資料夾也不跟符號連結、以開啟的檔案判斷大小；按停止顯示「已停止」不是錯誤。

