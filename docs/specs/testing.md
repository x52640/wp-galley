# 測試守則

> 擁有範圍：測試不得做的事、每類改動必備的測試、真實資料驗收。

- 測試**絕不呼叫真實 Agent CLI**（會消耗訂閱額度），一律用
  `tests/helpers/fake-adapter.ts`
- 測試**絕不連真實 WordPress**，用 `tests/helpers/mock-wordpress.ts`
- 核准失效的每一條路徑都要有測試：改內容、換圖、移動圖片、換封面
- 狀態機的每一個非法轉移都要有測試
- 真實 CLI 只在每階段收尾時手動驗收一次，腳本放 scratchpad 不進 repo。
- 每階段除了單元測試，都要拿**真實資料**實跑一次（115 篇文章、真實 CLI）——
  階段 2 就是這樣抓到「h2 沒人用」是錯的結論。
- 依名稱篩選：`npx vitest run -t "遮蔽"`；單一檔案：`npx vitest run tests/health.test.ts`。

## UI 驗收

- 畫面一律先用示範資料走一次：網址加 `?fixtures=1`，不需要後端也不會連 WordPress。
- 要實際點按、截圖時用 `node scripts/ui-drive.mjs <steps.json>`（無頭 Chrome，不用裝套件）。
  步驟格式寫在檔頭；先 `npm run build:ui`，對 `http://127.0.0.1:3000` 測（Vite 的 HMR 連線會讓
  無頭 Chrome 等不完）。
- 用真實後端時，**不按任何會寫到正式站的按鈕**（發布、上傳媒體）；那一步留給使用者。
