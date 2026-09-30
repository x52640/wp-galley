import { describe, expect, it } from 'vitest';
import { creatableTargets, destinationsRequest, enabledCountAfter, resolveTargetKey, shownTypeFilters } from '../src/ui/lib/targets.js';

/**
 * 畫面上停用類型的規則（P5-T032，D-032）：新稿件選單、拖放／貼上只給啟用的；
 * 精靈至少留一個啟用的才讓存；總覽的類型篩選只在停用的類型還有稿件時才留著。
 */

const t = (key: string, disabled = false) => ({ key, disabled });

describe('creatableTargets：能建新稿的類型', () => {
  it('停用的拿掉，順序不變', () => {
    expect(creatableTargets([t('read-think'), t('diary', true), t('post')]).map((item) => item.key)).toEqual(['read-think', 'post']);
  });
});

describe('enabledCountAfter：存完之後還有幾個啟用的', () => {
  it('既有的扣掉停用的，加上精靈新加的（已經有同 key 的不重算）', () => {
    const existing = [t('read-think'), t('diary')];
    expect(enabledCountAfter(existing, ['diary'], [])).toBe(1);
    expect(enabledCountAfter(existing, ['read-think', 'diary'], [])).toBe(0);
    expect(enabledCountAfter(existing, ['read-think', 'diary'], ['post'])).toBe(1);
    expect(enabledCountAfter([t('post')], ['post'], ['post'])).toBe(0);
  });
});

describe('shownTypeFilters：總覽的類型篩選', () => {
  it('停用的類型只在還有稿件時出現（舊稿件要找得到）', () => {
    const targets = [t('read-think'), t('diary', true), t('page', true)];
    expect(shownTypeFilters(targets, ['diary', 'read-think']).map((item) => item.key)).toEqual(['read-think', 'diary']);
  });
});

describe('resolveTargetKey：新稿件畫面的類型選擇（審查 low #1）', () => {
  it('從書籤進 #/new/diary、日記已停用：不留著看不到的選擇', () => {
    expect(resolveTargetKey('diary', [t('read-think'), t('post')])).toBeNull();
  });
  it('只剩一個能建的：直接選它（原本選的已停用也一樣）', () => {
    expect(resolveTargetKey('diary', [t('read-think')])).toBe('read-think');
    expect(resolveTargetKey(null, [t('read-think')])).toBe('read-think');
  });
  it('原本選的還能用：不動', () => {
    expect(resolveTargetKey('post', [t('read-think'), t('post')])).toBe('post');
    expect(resolveTargetKey(null, [t('read-think'), t('post')])).toBeNull();
  });
});

describe('destinationsRequest：停用清單只在動過開關時帶（審查 low #2）', () => {
  it('沒動開關：不帶 disabled（另一個分頁剛停用的不會被打開）', () => {
    expect(destinationsRequest({ include: ['post'], replace: [], disabled: ['diary'], initialDisabled: ['diary'] })).toEqual({
      include: ['post'],
      replace: [],
    });
  });
  it('動過開關：帶完整清單', () => {
    expect(destinationsRequest({ include: [], replace: [], disabled: ['diary', 'page'], initialDisabled: ['diary'] })).toEqual({
      include: [],
      replace: [],
      disabled: ['diary', 'page'],
    });
    expect(destinationsRequest({ include: [], replace: [], disabled: [], initialDisabled: ['diary'] }).disabled).toEqual([]);
  });
});
