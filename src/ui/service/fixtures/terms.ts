/** 分類項目（對應後端 `/api/wordpress/terms`，不經 CoreService）。 */

import type { PublisherApi, Term } from '../types.js';
import { clone, delay } from './context.js';

const TERMS: Record<string, Term[]> = {
  'read-think-tag': [
    { id: 12, name: '隨筆', slug: 'essay', count: 6 },
    { id: 13, name: '藝術', slug: 'art', count: 3 },
    { id: 14, name: '讀書心得', slug: 'reading-note', count: 3 },
    { id: 15, name: '經濟學', slug: '%e7%b6%93%e6%bf%9f%e5%ad%b8', count: 2 },
  ],
  'diary-category': [],
  category: [
    { id: 1, name: '未分類', slug: 'uncategorized', count: 3 },
    { id: 21, name: '教學', slug: 'tutorial', count: 5 },
  ],
};

export const termsApi: Pick<PublisherApi, 'listTerms' | 'createTerm'> = {
  async listTerms(taxonomy: string) {
    await delay(150);
    return clone(TERMS[taxonomy] ?? []);
  },

  async createTerm(taxonomy: string, name: string): Promise<Term> {
    await delay(300);
    const term: Term = { id: Math.floor(Math.random() * 900) + 100, name, slug: encodeURIComponent(name), count: 0 };
    TERMS[taxonomy] = [...(TERMS[taxonomy] ?? []), term];
    return term;
  },
};
