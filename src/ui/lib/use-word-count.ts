import { useEffect, useMemo, useState, type RefObject } from 'react';
import { countBodyWords } from '../../contract/word-count.js';
import { createThrottle } from './word-count.js';

/** 打字中最多每隔這麼久重算一次（長文不卡；第一下與最後一下一定算到）。 */
export const LIVE_COUNT_WAIT_MS = 300;

/**
 * 校樣底部的字數（P5-T047，D-045）。
 *
 * - 看稿：算存好的那一版正文（`publishHtml`），跟發布面板同一個數字。
 * - 打字模式：算 iframe 裡**正在編輯的**正文（`.preview-body`），不是上次存檔的。用 MutationObserver 聽正文的
 *   任何變動（打字、貼上整理、格式指令、存了留在打字模式），節流後重算，長文打字不卡。
 */
export function useWordCount({
  publishHtml,
  isEditing,
  frameRef,
  loadCount,
}: {
  publishHtml: string | null | undefined;
  isEditing: boolean;
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** iframe 載入次數：重載之後正文是新的元素，要重新接上。 */
  loadCount: number;
}): number {
  const saved = useMemo(() => countBodyWords(publishHtml), [publishHtml]);
  const [live, setLive] = useState<number | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setLive(null);
      return;
    }
    const body = frameRef.current?.contentDocument?.querySelector<HTMLElement>('.preview-body');
    if (!body) return;
    const recount = createThrottle(() => setLive(countBodyWords(body.innerHTML)), LIVE_COUNT_WAIT_MS);
    recount.call();
    const observer = new MutationObserver(() => recount.call());
    observer.observe(body, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      recount.cancel();
    };
  }, [isEditing, loadCount, frameRef]);

  return isEditing && live !== null ? live : saved;
}
