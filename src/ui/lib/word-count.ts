/**
 * 字數的畫面輔助（P5-T047，D-045）。怎麼算在 `contract/word-count.ts`；這裡只有顯示格式與打字中的節流。
 */

/** 字數的數字部分：千分位（畫面上數字用等寬字，「字」照介面字體）。 */
export function wordCountNumber(count: number): string {
  return count.toLocaleString('en-US');
}

/** 畫面上的「N 字」。 */
export function formatWordCount(count: number): string {
  return `${wordCountNumber(count)} 字`;
}

/** 滑鼠停在字數上的說明（校樣底部與發布面板共用）。 */
export const WORD_COUNT_HINT = '只算正文：中文一字算 1、英文與數字一個詞算 1；標題、圖說、標點不算';

export interface Throttle {
  /** 要求跑一次：距離上次跑超過 `wait` 就馬上跑，不然排在這段時間的尾巴跑（尾巴一定跑到）。 */
  call: () => void;
  /** 取消還沒跑的尾巴（離開打字模式、元件卸下）。 */
  cancel: () => void;
}

/**
 * 節流：長文打字時不要每打一個字就把整篇重算一次。第一下馬上跑（字數立刻有反應），
 * 之後 `wait` 毫秒內的要求併成一次、在尾巴跑，最後一個字一定會反映到數字上。
 */
export function createThrottle(fn: () => void, wait: number): Throttle {
  let lastRun = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = (): void => {
    timer = null;
    lastRun = Date.now();
    fn();
  };
  return {
    call: () => {
      if (timer !== null) return;
      const remaining = lastRun + wait - Date.now();
      if (remaining <= 0) run();
      else timer = setTimeout(run, remaining);
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
