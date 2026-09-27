# Agent CLI 與適配器

> 擁有範圍：三個 CLI 的實際參數、登入偵測、各家怪癖、adapter 介面與執行規則。
> 程式：`src/agents/`。

## 適配器規則

- **各家怪癖只准寫在 `src/agents/adapters/<該家>.ts`**，不要滲進 `process-runner`、
  `output-parser` 或 `output-contract`。要在驗證前修正輸出就用 `parseAndValidate` 的
  `transform` 參數。
- 送給 CLI 的 schema 可以為相容性放寬，但**後端一定要用原始 schema 再驗一次**。
  放寬的只是給模型端的提示，不是驗證標準。
- 輸出不是合法 JSON、schema 不合格、漏掉必要欄位或嘗試加入不允許 HTML，後端拒絕
  該結果並允許重試，不得直接發布。輸出契約本身的唯一權威是
  `src/agents/output-contract.ts`（校稿與配圖：`REVIEW_OUTPUT_SCHEMA`；建議英文網址：`SLUG_OUTPUT_SCHEMA`，
  P5-T026，只有一個必填的 `slugs` 字串陣列，三家不用特別轉換——Codex strict 只濾掉 `maxItems`／`maxLength`）。

## Adapter 介面與執行規則

```ts
interface AgentAdapter {
  id: "codex" | "claude" | "google";
  detect(): Promise<AgentStatus>;
  listModels(): Promise<ModelOption[]>;
  runStructured<T>(request: AgentRequest, schema: JsonSchema): Promise<AgentResult<T>>;
  cancel(runId: string): Promise<void>;
  /** 只有做得到的 adapter 才有（目前只有 Codex，D-017）。沒有就代表這一家不能生圖。 */
  generateImage?(request: ImageRequest, runId: string): Promise<AgentResult<GeneratedImage>>;
}
```

`AgentRegistry.imageGeneratorId()` 找有 `generateImage` 的那一家，不寫死名字；`generateImage` 跟
`runStructured` 排同一條佇列（concurrency 1）。校稿或生圖排在佇列裡就被取消的話，輪到它時直接回 `cancelled`，
不叫 adapter（每一次都花額度；校稿這條是 P5-T020 補上的）。生圖流程與規則見 [agent-tasks.md](agent-tasks.md)。

`AgentStatus` 至少包含：已安裝、版本、登入狀態是否可確認、支援的輸出格式與目前是否可用。不要在 UI 顯示登入 token。

執行規則：`spawn`＋參數陣列、prompt 走 stdin、timeout／取消／輸出上限／concurrency 1、
隔離工作區、不授權任何工具——全部是 [security.md](security.md) 的硬性禁令，這裡不重抄。
adapter 自己要做的：stdout 與 stderr 分開處理，log 前先過秘密遮蔽；Agent 只回傳結構化內容，
所有發布動作由後端執行。

## 設定精靈給的指令（P8-T002）

精靈第二步把安裝與登入指令印給使用者自己執行（`src/agents/setup-hints.ts`），發布台不代為執行。
偵測沿用各 adapter 的 `detect()`（`GET /api/setup/agents` 帶 `refresh`，不吃 30 秒快取）。

| CLI | 安裝 | 登入 | 驗證狀態 |
| --- | --- | --- | --- |
| Codex | `npm install -g @openai/codex`（或 `brew install codex`） | `codex login` | 套件名與登入指令跟官方文件一致；作者機器是 Homebrew 裝的 |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude auth login` | 登入指令跟 adapter 的 unavailableReason 同一條 |
| Antigravity | 從 https://antigravity.google 下載安裝 | 第一次執行 `agy` 時登入；`agy models` 列得出模型就代表好了 | ⚠️ **未查證**：沒找到官方的 CLI 安裝指令，寫的是「裝桌面版、終端機要找得到 agy」 |

CLI 改版或官方換了安裝方式，改這一個檔就好（README 的表格要一起改）。

## 探查結果

探查日期：2026-08-27。全部為唯讀檢查（`--help`、`--version`、登入狀態），
未執行任何會消耗訂閱額度的推論，未讀取、輸出或記錄任何憑證。

計畫 §6.1 與 §14.9 都要求以**本機安裝版本的官方 `--help` 為準**，不要沿用文件裡
寫死的參數。CLI 改版後請重跑一次探查並更新這份文件。

### 結論：三個目標 CLI 全部可用

| | Codex | Claude Code | Antigravity |
| --- | --- | --- | --- |
| 執行檔 | `/opt/homebrew/bin/codex` | `~/.local/bin/claude` | `~/.local/bin/agy` |
| 版本 | 0.147.0 | 2.1.247 | 1.1.22 |
| 非互動 | `codex exec` | `-p` / `--print` | `-p` / `--print` |
| 結構化輸出 | `--json`（JSONL 事件）<br>`-o FILE`（最終訊息寫檔） | `--output-format json` | `--output-format json` |
| **JSON Schema 強制** | `--output-schema FILE` | `--json-schema <字串或檔案>` | `--json-schema <字串或檔案>` |
| 指定模型 | `-m` | `--model` | `--model` |
| 列出模型 | 無指令 | 無指令 | `agy models` |
| 工作目錄 | `-C DIR` | 行程 cwd（`--add-dir` 加額外目錄） | `--add-dir` |
| 限制工具 | `-s read-only` | `--disallowed-tools`、`--permission-mode` | `--sandbox` |
| 逾時 | 自行控制 | 自行控制 | `--print-timeout`（預設 5m） |

**三個都支援 JSON Schema 強制結構化輸出**，所以都不必標成 `experimental`。
這比計畫寫作當下的假設好——計畫原本擔心「無法穩定提供 JSON 的 Agent」。

### 登入狀態偵測

只判斷「有沒有登入」，不取出也不記錄任何憑證。

| CLI | 指令 | 輸出 |
| --- | --- | --- |
| Codex | `codex login status` | 純文字，例如 `Logged in using ChatGPT`；未登入時 exit code 非 0 |
| Claude | `claude auth status --json` | JSON，含 `loggedIn`、`authMethod`、`subscriptionType` |
| Antigravity | `agy models` | 成功列出模型即代表已登入 |

⚠️ `claude auth status --json` 的輸出**含 email 與 orgId**。發布台只取
`loggedIn`、`authMethod`、`subscriptionType` 三個欄位，其餘一律丟棄，不寫進
資料庫、log 或 API 回應。

### 沒有採用的 CLI

`gemini`（Gemini CLI 0.55.1，`/opt/homebrew/bin/gemini`）也裝在這台機器上，
但**沒有 `--json-schema` 之類的結構化輸出強制參數**，只有 `-o json` 包裝整個回應。
要用它就得自行解析並在格式錯誤時重試，可靠度低於前三者。

計畫 §6.2 指名的 Google Agent 是 Antigravity CLI（`agy`），而 `agy` 具備
`--json-schema`，所以 MVP 採用 `agy`，不採用 `gemini`。日後要加只需新增一個
adapter，介面不變。

各 CLI 的具體參數寫在對應的 adapter 檔案裡，不散落在共用程式碼中。

### 實作時踩到的坑（2026-08-27 實測記錄）

`--help` 沒寫、但實際會炸的東西。CLI 改版後請重新驗證這一節。

#### Codex 生圖（2026-09-23 實測，codex-cli 0.153.4）

`--help` 看不出來，但 `codex features list` 的 `image_generation` 是 stable／true，用訂閱就能生圖。

| 事實 | 細節 |
| --- | --- |
| 非互動模式可用 | `codex exec --json --skip-git-repo-check -C <dir> "<請生成…>"`，約 54 秒 |
| 產出 | PNG 1672×941（要求 16:9），1.7 MB |
| 圖檔位置 | **一定**在 `~/.codex/generated_images/<thread_id>/exec-<uuid>.png`；`thread_id` 是第一個事件 `{"type":"thread.started","thread_id":…}` |
| 叫它存到工作目錄 | 它會用 shell `cp` 複製過去，需要 `workspace-write`。**不要靠這個**：直接從上面的位置讀，Agent 就能維持 `read-only` |
| 事件流 | 生圖本身不出現在 item 事件裡；看得到的是它讀 imagegen skill、以及 cp 指令 |
| 額度 | 這一次 input 114k tokens（多半是快取）、output 427 |
| 雜訊 | 使用者本機設定的 Figma MCP 沒登入，stderr 會有一行 `AuthRequired` 錯誤，不影響結果 |

**實作（`CodexAdapter.generateImage`，P5-T013）**：

- 參數：`exec --json --skip-git-repo-check -C <job workspace> -s read-only --ephemeral --ignore-user-config
  --color never`。prompt 走 **stdin**，不放在命令列（[security.md](security.md) 的硬性禁令；Task 寫的是
  位置參數，以 security.md 為準）。
- `--ephemeral`、`--ignore-user-config` 跟校稿（runStructured）一樣帶：stdin 裡有 Agent 寫的 brief 文字
  （不受信任），不能讓使用者 `config.toml` 裡的 MCP、網路搜尋、自訂指令套用到這一趟（D-009）。
  **已驗證（2026-09-24）**：使用者從插圖面板「請 AI 配一張」真實生圖、按「用這張」上傳並放進正文、
  存成草稿，全程正常——帶著這兩個參數生圖沒有問題。
- `CODEX_HOME`：沒設就是 `~/.codex`。process-runner 的環境變數 allowlist 不含它，所以用 `extraEnv`
  明確傳給子行程，確保子行程寫圖的位置跟我們讀圖的位置是同一個。
- 讀圖：`thread_id` 只接受 `^[A-Za-z0-9][A-Za-z0-9-]{0,127}$`（拿去組路徑）；`generated_images/<thread>`
  本身用 lstat 確認是真的資料夾（不是符號連結）；檔案只看 png／jpg／webp，用 `O_NOFOLLOW` 開、以開起來那個檔的
  fstat 判斷大小（上限 20 MB），只讀那麼多；有好幾張拿最新的。圖檔不刪（那是 Codex 的資料夾）。
- 取消或逾時就不拿圖，即使圖已經生出來。exit code 非 0 但圖在，照樣收（實測 stderr 有雜訊）。
- 失敗時把事件流裡最後一個 `error`／`turn.failed` 的訊息帶給使用者。`AgentFailureReason` 多一個 `no-image`。
- 圖本身不信任：後端再用 `src/media/validate.ts` 依檔頭驗一次。
- 測試用假的執行檔＋暫存 `CODEX_HOME`（`tests/codex-image.test.ts`），不跑真的 codex。

#### Codex

| 問題 | 處理 |
| --- | --- |
| `codex exec` **不接受** `--ask-for-approval`（那是互動模式的參數） | 移除；exec 本身就非互動 |
| `--output-schema` 最終變成 OpenAI 的 `response_format`，要求**每一層物件**都有 `additionalProperties: false` | 見 `adapters/openai-strict.ts` |
| 同上，`required` 必須列出 `properties` 的**每一個** key | 選填欄位改成 nullable 後全部列入 |
| 同上，不支援 `minLength` / `maxLength` / `pattern` 等約束 | 送出前濾掉；**後端仍用原始 schema 驗證，約束沒少** |
| strict mode 會把沒填的選填欄位回成 `null` | 驗證前先 `stripNulls` |

#### Claude Code

| 問題 | 處理 |
| --- | --- |
| `--json-schema` 內建 draft-07 驗證器，看到 `$schema: draft/2020-12` 會直接報 `no schema with key or ref` | 送出前拿掉 `$schema`（`schemaForCli`） |

#### Antigravity

| 問題 | 處理 |
| --- | --- |
| `--print` 會把下一個參數吃掉當 prompt，`--print --output-format json` 會壞掉 | 用 `--print=`（空值） |
| `--print=` 空值時報 `empty prompt`，**agy 不從 stdin 讀純文字** | 改走 `--input-format stream-json` |
| stream-json 的輸入訊息鍵名是 **`event`** 不是 `type`（官方說明沒寫） | `{"event":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}` |
| 結果包兩層：`{"event":"result","result":{"response":"<真正的 JSON 字串>"}}` | output-parser 遞迴拆包 |
| 會在輸出最外層多塞 `toolAction`、`toolSummary` | adapter 只刪這兩個已知欄位，其餘多餘欄位照樣被擋 |
| 沒有停用工具的參數；它若自行呼叫 `read_file` 會被 headless 自動拒絕，然後**整份不輸出** | prompt 開頭明確告知沒有可用工具（`NO_TOOLS_NOTICE`） |

#### 共通

`execFile` 不會關閉子行程的 stdin，等 EOF 的 CLI（`agy models` 就是）會一路等到逾時。
探查一律改走 `runProcess`，它會 `stdin.end()`。

### 驗收實測結果

原稿：一段 84 字的日記，刻意留三個錯字（一整**夭**、錄**印**、別**忸**）。
三家都用 `diary-v1` 模板，走完整流程到渲染出可發布的 HTML。

| Agent | 耗時 | 抓到錯字 | 通過校稿 schema | 通過模板驗證 |
| --- | --- | --- | --- | --- |
| Codex | 13.7s | 3 / 3 | ✅ | ✅ |
| Claude Code | 22.0s | 3 / 3 | ✅ | ✅ |
| Antigravity | 27.3s | 3 / 3 | ✅ | ✅ |

三家都正確保留了標題、沒有改動語氣、`imageBriefs` 依規則回空陣列。
Codex 與 Claude 產出的 `contentHash` **完全相同**，代表兩者對這段文字的校正結果一字不差。
