# MCP Server（尚未實作）

> 狀態：**草案**。來源：原始計畫 §10，尚未依實測修訂。
> 擁有範圍：MCP 工具清單與 MCP 專屬的安全規則。

MCP 與網頁 UI 共用同一個 `CoreService`（規則見 [security.md](security.md)）；
核准相關方法 MCP 不得呼叫（[state-machine.md](state-machine.md)）。

第一版 MCP tools：

- `publisher_status`：回傳本機服務、Agent、WordPress 連線狀態，不回傳秘密。
- `list_publish_targets`：列出可發布位置及限制。
- `list_templates`：列出模板版本、內容類型與 schema 摘要。
- `create_draft_job`：建立本機工作項目並保存原稿。
- `review_article`：使用指定可用 Agent 產生結構化校稿結果。
- `render_revision`：驗證並渲染指定 revision。
- `prepare_media`：建立圖片需求；不自動刪除或發布。
- `upload_media`：只上傳使用者已提供並核准的本機檔案。
- `create_wordpress_draft`：建立 draft，不可 publish。
- `get_preview`：取得本機或 WordPress 預覽資訊。
- `prepare_publish`：產生發布摘要與待人工核准狀態。
- `publish_approved_revision`：只有 UI 已存在匹配 revision hash 的 approval record 才能執行。
- `restore_snapshot`：只有 UI 已建立還原核准才能執行。

MCP 安全規則：

- Tool description 明確標示讀取、寫入、發布與還原的影響。
- 所有輸入使用 Zod／JSON Schema 驗證。
- 檔案參數只接受 job workspace 內的 resolved path，防止 path traversal。
- MCP Client 不能取得 Application Password。
- MCP Client 不能製造、修改或猜測 approval token。
- Tool output 對遠端 HTML、文章及 log 做大小限制。
- 預設所有 WordPress 寫入都使用 draft。
- 不提供任意 HTTP request、任意 shell 或任意 WordPress endpoint 工具。
