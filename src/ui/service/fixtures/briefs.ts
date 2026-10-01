/** 配圖需求：卡片上改描述、不要了（對應後端 `service/briefs.ts`）。 */

import { briefEditFieldError, checkBriefPrompt } from '../../../contract/brief-prompt.js';
import { checkUserNote } from '../../../contract/user-note.js';
import type { ImageBrief, PublisherApi } from '../types.js';
import { clone, delay, mustGet } from './context.js';

export const briefsApi: Pick<PublisherApi, 'dismissImageBrief' | 'updateImageBrief'> = {
  async dismissImageBrief(uuid: string, briefId: number) {
    await delay(120);
    const job = mustGet(uuid);
    job.imageBriefs = job.imageBriefs.filter((brief) => brief.id !== briefId);
  },

  /**
   * 在卡片上改配圖需求（P5-T025）。跟後端同一套檢查（沒有密碼那一項：示範資料不知道密碼）。
   * 使用者那條的 prompt 在示範資料裡本來就是一句說明，不重組；錨點對不對得上也不模擬。
   */
  async updateImageBrief(uuid: string, briefId: number, input) {
    await delay(200);
    const job = mustGet(uuid);
    const brief = job.imageBriefs.find((row) => row.id === briefId);
    if (!brief) throw new Error(`找不到這個工作項目的配圖需求 ${briefId}`);
    const run = job.agentRun;
    if (run?.status === 'running' && run.task === 'generate-image' && run.briefId === briefId) {
      throw new Error('Codex 正在畫這張，等它跑完再改');
    }
    const wrongField = briefEditFieldError(brief.origin, input);
    if (wrongField !== null) throw new Error(wrongField);
    let next: ImageBrief;
    if (brief.origin === 'user') {
      const checked = checkUserNote(input.note);
      if (!checked.ok) throw new Error(checked.message);
      next = { ...brief, note: checked.note };
    } else {
      const checked = checkBriefPrompt(input.prompt);
      if (!checked.ok) throw new Error(checked.message);
      // 改過就一直算改過（跟後端一樣看事件，不比對內容）：之後的 Agent 不蓋掉（P5-T027）。
      next = { ...brief, prompt: checked.prompt, promptEdited: true };
    }
    job.imageBriefs = job.imageBriefs.map((row) => (row.id === briefId ? next : row));
    return { brief: clone(next), notice: null };
  },
};
