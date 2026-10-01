/**
 * 前後端共用的 HTTP 契約（docs/specs/http-api.md，決策 D-015）。
 *
 * **這是線上資料形狀的唯一定義。** 後端的 CoreService 回傳這些型別，路由把它們
 * 包進回應信封，前端直接 import 同一份——後端改了欄位，前端在編譯期就會壞，
 * 不會等到畫面出錯才發現。以前前端有一份手抄的，抄漏了沒有人知道。
 *
 * 規則：
 * - 這個資料夾**只准 import 同資料夾的檔**（`./xxx.js`，P5-T004）；不准 Fastify、React、
 *   `node:*`，也不准 `src/core`。依賴方向是 core／server／ui → contract，反過來就會把後端
 *   拖進瀏覽器 bundle。
 * - 只放會過網路的形狀。後端內部用的列（`*Row`）、前端才有的東西（Blob）不放這裡。
 * - 欄位一律 readonly：這些是讀到的資料，不是拿來改的狀態。
 */

// 依領域拆在同資料夾的 api-*.ts（P5-T004）；這裡全部轉出，呼叫端照舊從 api.ts import。
export * from './api-enums.js';
export * from './api-compare.js';
export * from './api-review.js';
export * from './api-job.js';
export * from './api-requests.js';
export * from './api-responses.js';
export * from './api-setup.js';
