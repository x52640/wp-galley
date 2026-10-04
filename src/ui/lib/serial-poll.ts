/**
 * 一次只跑一個的輪詢（PR #28 第三輪 Codex P2）：立刻跑一次，**上一次結束（成功或失敗）之後**等 `delayMs` 才跑下一次。
 *
 * 不用 `setInterval`：重讀比間隔還久時（例如查證清單讀得慢），固定間隔會一直送新的重讀、推進工作區的世代，
 * 每個回應回來時都已經不是最新的一個、被當成過期丟掉，待同步永遠解不開。
 *
 * 回傳停止函式：停掉之後，跑到一半的那一次結束也不再排下一次。不碰 React，可以直接在 node 裡測。
 */
export function startSerialPoll(run: () => Promise<unknown>, delayMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async (): Promise<void> => {
    timer = null;
    try {
      await run();
    } catch {
      // 失敗照樣排下一次；錯誤由 run 自己處理（工作區的重讀會把錯誤寫在畫面上）。
    }
    if (!stopped) timer = setTimeout(() => void tick(), delayMs);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
