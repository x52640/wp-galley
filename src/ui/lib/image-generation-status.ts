import { useEffect, useState } from 'react';
import { api, describeError } from '../service/client.js';
import type { ImageGenerationStatus } from '../service/types.js';

/**
 * 能不能生圖。有配圖需求時才去問（後端要跑一次 `codex login status`）。
 * 問不到就當作不能生，原因照實講——不要讓按鈕看起來能按、按下去才失敗。
 * 配圖面板、插圖面板、選字「用此段配圖」共用（P5-T044 從 MediaPanel 搬出來）。
 */
export function useImageGenerationStatus(wanted: boolean): ImageGenerationStatus | null {
  const [status, setStatus] = useState<ImageGenerationStatus | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    api
      .getImageGenerationStatus()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch((cause: unknown) => {
        if (alive) {
          setStatus({ available: false, provider: null, reason: `無法確認 Codex 能不能用：${describeError(cause)}` });
        }
      });
    return () => {
      alive = false;
    };
  }, [wanted]);
  return status;
}
