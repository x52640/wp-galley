import { describe, expect, it } from 'vitest';

import { stageDisplay } from '../src/ui/lib/stage-view.js';

/** 主區顯示什麼（D-018）：拿掉三段切換後，成品只在發布面板打開時出現。 */
describe('stageDisplay', () => {
  it('預設是標著建議的文章', () => {
    expect(stageDisplay('article', false)).toEqual({ proof: 'edit', compare: false });
  });

  it('切到對照：對照蓋在校樣上，校樣照樣是標記版', () => {
    expect(stageDisplay('compare', false)).toEqual({ proof: 'edit', compare: true });
  });

  it('發布面板打開時一定是乾淨成品', () => {
    expect(stageDisplay('article', true)).toEqual({ proof: 'final', compare: false });
  });

  it('就算剛才在對照，打開發布面板也不能讓對照蓋住成品', () => {
    expect(stageDisplay('compare', true)).toEqual({ proof: 'final', compare: false });
  });

  it('關掉發布面板就回到原本那一種', () => {
    expect(stageDisplay('compare', false).compare).toBe(true);
    expect(stageDisplay('article', false).compare).toBe(false);
  });
});
