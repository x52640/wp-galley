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
