# 本機 Agent CLI 探查結果

探查日期：2026-08-27。全部為唯讀檢查（`--help`、`--version`、登入狀態），
未執行任何會消耗訂閱額度的推論，未讀取、輸出或記錄任何憑證。

計畫 §6.1 與 §14.9 都要求以**本機安裝版本的官方 `--help` 為準**，不要沿用文件裡
寫死的參數。CLI 改版後請重跑一次探查並更新這份文件。

## 結論：三個目標 CLI 全部可用

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

## 登入狀態偵測

只判斷「有沒有登入」，不取出也不記錄任何憑證。

| CLI | 指令 | 輸出 |
| --- | --- | --- |
| Codex | `codex login status` | 純文字，例如 `Logged in using ChatGPT`；未登入時 exit code 非 0 |
| Claude | `claude auth status --json` | JSON，含 `loggedIn`、`authMethod`、`subscriptionType` |
| Antigravity | `agy models` | 成功列出模型即代表已登入 |

⚠️ `claude auth status --json` 的輸出**含 email 與 orgId**。發布台只取
`loggedIn`、`authMethod`、`subscriptionType` 三個欄位，其餘一律丟棄，不寫進
資料庫、log 或 API 回應。

## 沒有採用的 CLI

`gemini`（Gemini CLI 0.55.1，`/opt/homebrew/bin/gemini`）也裝在這台機器上，
但**沒有 `--json-schema` 之類的結構化輸出強制參數**，只有 `-o json` 包裝整個回應。
要用它就得自行解析並在格式錯誤時重試，可靠度低於前三者。

計畫 §6.2 指名的 Google Agent 是 Antigravity CLI（`agy`），而 `agy` 具備
`--json-schema`，所以 MVP 採用 `agy`，不採用 `gemini`。日後要加只需新增一個
adapter，介面不變。

## 執行時的安全參數（計畫 §6.2）

三個 adapter 共同遵守：

- 一律 `spawn` + 參數陣列，**不使用 `shell: true`**。
- Prompt 走 stdin，不放進命令列參數（避免 injection 與長度限制）。
- 工作目錄設為該 job 的隔離工作區，不是使用者家目錄。
- 校稿工作不授權 shell、檔案寫入、網路或 WordPress 工具。
- 每次執行設定 timeout、可取消、輸出大小上限，同一時間只跑一個（concurrency 1）。
- stdout 與 stderr 分開處理，log 前先過秘密遮蔽。

各 CLI 的具體參數寫在對應的 adapter 檔案裡，不散落在共用程式碼中。

---

## 實作時踩到的坑（2026-08-27 實測記錄）

`--help` 沒寫、但實際會炸的東西。CLI 改版後請重新驗證這一節。

### Codex

| 問題 | 處理 |
| --- | --- |
| `codex exec` **不接受** `--ask-for-approval`（那是互動模式的參數） | 移除；exec 本身就非互動 |
| `--output-schema` 最終變成 OpenAI 的 `response_format`，要求**每一層物件**都有 `additionalProperties: false` | 見 `adapters/openai-strict.ts` |
| 同上，`required` 必須列出 `properties` 的**每一個** key | 選填欄位改成 nullable 後全部列入 |
| 同上，不支援 `minLength` / `maxLength` / `pattern` 等約束 | 送出前濾掉；**後端仍用原始 schema 驗證，約束沒少** |
| strict mode 會把沒填的選填欄位回成 `null` | 驗證前先 `stripNulls` |

### Claude Code

| 問題 | 處理 |
| --- | --- |
| `--json-schema` 內建 draft-07 驗證器，看到 `$schema: draft/2020-12` 會直接報 `no schema with key or ref` | 送出前拿掉 `$schema`（`schemaForCli`） |

### Antigravity

| 問題 | 處理 |
| --- | --- |
| `--print` 會把下一個參數吃掉當 prompt，`--print --output-format json` 會壞掉 | 用 `--print=`（空值） |
| `--print=` 空值時報 `empty prompt`，**agy 不從 stdin 讀純文字** | 改走 `--input-format stream-json` |
| stream-json 的輸入訊息鍵名是 **`event`** 不是 `type`（官方說明沒寫） | `{"event":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}` |
| 結果包兩層：`{"event":"result","result":{"response":"<真正的 JSON 字串>"}}` | output-parser 遞迴拆包 |
| 會在輸出最外層多塞 `toolAction`、`toolSummary` | adapter 只刪這兩個已知欄位，其餘多餘欄位照樣被擋 |
| 沒有停用工具的參數；它若自行呼叫 `read_file` 會被 headless 自動拒絕，然後**整份不輸出** | prompt 開頭明確告知沒有可用工具（`NO_TOOLS_NOTICE`） |

### 共通

`execFile` 不會關閉子行程的 stdin，等 EOF 的 CLI（`agy models` 就是）會一路等到逾時。
探查一律改走 `runProcess`，它會 `stdin.end()`。

## 驗收實測結果

原稿：一段 84 字的日記，刻意留三個錯字（一整**夭**、錄**印**、別**忸**）。
三家都用 `diary-v1` 模板，走完整流程到渲染出可發布的 HTML。

| Agent | 耗時 | 抓到錯字 | 通過校稿 schema | 通過模板驗證 |
| --- | --- | --- | --- | --- |
| Codex | 13.7s | 3 / 3 | ✅ | ✅ |
| Claude Code | 22.0s | 3 / 3 | ✅ | ✅ |
| Antigravity | 27.3s | 3 / 3 | ✅ | ✅ |

三家都正確保留了標題、沒有改動語氣、`imageBriefs` 依規則回空陣列。
Codex 與 Claude 產出的 `contentHash` **完全相同**，代表兩者對這段文字的校正結果一字不差。
