import { describe, expect, it } from 'vitest';
import { NO_TARGETS_MESSAGE, typeLabel } from '../src/ui/components/JobList.js';
import { SITE_CONFIG_MISSING_MESSAGE } from '../src/wordpress/targets.js';

describe('介面上的類型名稱', () => {
  it('作者站台照舊：長文、日記', () => {
    expect(typeLabel('longform', 'read-think')).toBe('長文');
    expect(typeLabel('diary', 'diary')).toBe('日記');
  });

  it('通用類型要看 postType 才分得出文章與頁面', () => {
    expect(typeLabel('article', 'post')).toBe('文章');
    expect(typeLabel('article', 'page')).toBe('頁面');
    expect(typeLabel('article')).toBe('文章');
  });

  it('不認得的類型原樣顯示，沒有類型叫「稿件」', () => {
    expect(typeLabel('news')).toBe('news');
    expect(typeLabel(undefined)).toBe('稿件');
  });

  it('沒有站台設定時，前後端講同一句話', () => {
    expect(NO_TARGETS_MESSAGE).toBe(SITE_CONFIG_MISSING_MESSAGE);
  });
});
