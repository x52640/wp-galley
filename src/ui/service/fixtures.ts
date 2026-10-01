/**
 * 示範資料（`?fixtures=1`）：沒有後端也能把每個畫面、每個狀態走一遍——
 * 尤其是「印章被撕掉」這種很難在真實流程裡湊出來的狀態。開啟時畫面上方永遠掛一條橫幅，
 * 不會有人把示範資料誤認成真的稿件。
 *
 * 這個檔只把各領域拼成 `PublisherApi`；內容照後端 `src/core/service/` 的領域拆在 `fixtures/` 底下（P5-T033）：
 *
 * | 檔 | 負責 |
 * | --- | --- |
 * | `data.ts` | 示範內容：發布目標、正文、校對符號、待處理清單、配圖需求 |
 * | `store.ts` | 每篇示範稿件的初始狀態（記憶體裡，重新整理就重來） |
 * | `context.ts` | 共用小工具：讀稿件、拆正文、換一版正文、撕核准 |
 * | `jobs.ts`、`content.ts`、`agent.ts`、`review.ts`、`briefs.ts`、`images.ts`、`media.ts`、`approval.ts`、`publish.ts`、`authors.ts`、`setup.ts` | 跟後端同名檔對應的那幾個方法 |
 * | `terms.ts` | 分類項目（後端是 `/api/wordpress/terms`） |
 *
 * 規矩（D-033）：前後端都要的規則一律用 `src/contract` 的純函式，這裡只放假資料與「假裝是資料庫」的部分，不重寫規則。
 */

import type { PublisherApi } from './types.js';
import { agentApi } from './fixtures/agent.js';
import { approvalApi } from './fixtures/approval.js';
import { authorsApi } from './fixtures/authors.js';
import { briefsApi } from './fixtures/briefs.js';
import { contentApi } from './fixtures/content.js';
import { imagesApi } from './fixtures/images.js';
import { jobsApi } from './fixtures/jobs.js';
import { mediaApi } from './fixtures/media.js';
import { publishApi } from './fixtures/publish.js';
import { reviewApi } from './fixtures/review.js';
import { setupApi } from './fixtures/setup.js';
import { termsApi } from './fixtures/terms.js';

export { FIXTURE_SETUP_SCENARIOS, setFixtureSetupScenario, type FixtureSetupScenario } from './fixtures/setup.js';

export const fixtureApi: PublisherApi = {
  ...jobsApi,
  ...contentApi,
  ...agentApi,
  ...reviewApi,
  ...briefsApi,
  ...imagesApi,
  ...mediaApi,
  ...approvalApi,
  ...publishApi,
  ...termsApi,
  ...authorsApi,
  ...setupApi,
};
