/**
 * 正在跑的 Agent 動作會不會「鎖住內容」（P5-T016）。後端 `service/media.ts` 與示範資料用同一份（P5-T033）。
 *
 * 校稿與一鍵配圖跑完會檢查「派工時的那一版還是不是目前這一版」，不是就整份丟掉；所以它們跑的期間，
 * 上傳的附帶動作（自動放進正文、自動設精選）不能建新版本。生圖、建議網址不在此列：
 * 候選圖與網址候選都不是對著某一版文字套用的。查證（`factcheck`）也不在此列（D-036）：結果不改文章，
 * 讀取時用 excerpt 對著最新版重新定位，跑的期間照常可以改字、放圖、設封面、套用建議。
 */

/** 這種 task（後端是 `agent_runs.purpose`）跑的時候會不會鎖住內容。讀不到（`undefined`）當成會。 */
export function taskLocksContent(task: string | null | undefined): boolean {
  return task !== 'generate-image' && task !== 'suggest-slug' && task !== 'factcheck';
}

/** 這一趟（`JobDetail.agentRun`）正在跑、而且會鎖住內容。 */
export function runLocksContent(run: { readonly status: string; readonly task: string } | null | undefined): boolean {
  return run?.status === 'running' && taskLocksContent(run.task);
}
