import { describe, expect, it } from 'vitest';
import { applyChanges, isAlreadyDone, type ChangeSlot } from '../src/core/review-apply.js';

const slot = (ordinal: number, find: string, replaceWith: string | null): ChangeSlot => ({
  ordinal,
  find,
  replaceWith,
});

const base = {
  title: '20260828',
  body: '<p class="wp-block-paragraph">這樣做不彷試試，我覺得可以。</p>',
};

describe('逐條套用校稿建議', () => {
  it('只套用勾選的那幾項，沒勾的原封不動', () => {
    const result = applyChanges(base, [
      slot(0, '不彷', '不妨'),
      slot(1, '我覺得', null), // 沒勾，只用來定位
    ]);
    expect(result.replaced).toEqual([0]);
    expect(result.templateData['body']).toContain('不妨試試');
    expect(result.templateData['body']).toContain('我覺得可以');
  });

  it('不改動輸入的物件', () => {
    const input = structuredClone(base);
    applyChanges(input, [slot(0, '不彷', '不妨')]);
    expect(input).toEqual(base);
  });

  it('定位不到就回報 notFound，不亂猜位置', () => {
    const result = applyChanges(base, [slot(0, '這句話根本不在文章裡', '換掉')]);
    expect(result.replaced).toEqual([]);
    expect(result.notFound).toEqual([0]);
    expect(result.templateData).toEqual(base);
  });

  it('before 是空字串（純新增）也算定位不到，不會插到開頭', () => {
    const result = applyChanges(base, [slot(0, '', '硬塞進來的字')]);
    expect(result.notFound).toEqual([0]);
    expect(result.templateData['body']).toBe(base.body);
  });

  it('同一個短字串出現很多次，照順序一項對一個位置', () => {
    const many = { body: '甲的乙的丙的' };
    const result = applyChanges(many, [
      slot(0, '的', '之'),
      slot(1, '的', '與'),
      slot(2, '的', '和'),
    ]);
    expect(result.replaced).toEqual([0, 1, 2]);
    expect(result.templateData['body']).toBe('甲之乙與丙和');
  });

  it('沒勾的項目照樣推游標，後面那一項才不會套錯位置', () => {
    const many = { body: '甲的乙的丙的' };
    const result = applyChanges(many, [
      slot(0, '的', null), // 第一個「的」保留
      slot(1, '的', '與'), // 要改的是第二個
    ]);
    expect(result.templateData['body']).toBe('甲的乙與丙的');
  });

  it('已經套用過的項目用 after 定位，游標不會走偏', () => {
    // 第 0 項先前已經套用（不彷 → 不妨），現在只補套第 1 項。
    const applied = { body: '這樣做不妨試試，我覺得可以。' };
    const result = applyChanges(applied, [
      slot(0, '不妨', null),
      slot(1, '我覺得', '我認為'),
    ]);
    expect(result.replaced).toEqual([1]);
    expect(result.templateData['body']).toBe('這樣做不妨試試，我認為可以。');
  });

  it('改動落在哪個欄位由內容決定，標題也改得到', () => {
    const result = applyChanges({ title: '錯的標題', body: '正文' }, [slot(0, '錯的', '對的')]);
    expect(result.templateData['title']).toBe('對的標題');
    expect(result.templateData['body']).toBe('正文');
  });

  it('陣列裡的字串也走得到（例如 tags）', () => {
    const result = applyChanges({ body: '正文', tags: ['讀書', '隨筆'] }, [slot(0, '隨筆', '散文')]);
    expect(result.templateData['tags']).toEqual(['讀書', '散文']);
  });

  it('Agent 沒照順序列改動時，從頭再找一次當退路', () => {
    const many = { body: '前面甲後面乙' };
    const result = applyChanges(many, [
      slot(0, '乙', '丁'), // 先改後面的
      slot(1, '甲', '丙'), // 再改前面的：游標已經過去了，要能回頭找
    ]);
    expect(result.replaced).toEqual([0, 1]);
    expect(result.templateData['body']).toBe('前面丙後面丁');
  });

  // --- Codex review 抓到的：定位不能碰到標記 ---------------------------------

  it('撞到 HTML 屬性的不算定位到，標記不會被改掉', () => {
    const html = { body: '<p class="wp-block-paragraph">段落裡也有 paragraph 這個字</p>' };
    const result = applyChanges(html, [slot(0, 'paragraph', '段落')]);
    // 改到的是文字裡那一個，不是 class 屬性裡的那一個。
    expect(result.templateData['body']).toBe('<p class="wp-block-paragraph">段落裡也有 段落 這個字</p>');
  });

  it('只出現在標籤裡的字串當作定位不到', () => {
    const html = { body: '<p class="wp-block-paragraph">今天讀完這本書</p>' };
    const result = applyChanges(html, [slot(0, 'wp-block-paragraph', 'evil')]);
    expect(result.notFound).toEqual([0]);
    expect(result.templateData['body']).toBe(html.body);
  });

  it('跨過標籤邊界的也不算——換掉會把標籤吃掉', () => {
    const html = { body: '<p>今天<em>讀完</em>這本書</p>' };
    const result = applyChanges(html, [slot(0, '今天讀完', '昨天讀完')]);
    expect(result.notFound).toEqual([0]);
    expect(result.templateData['body']).toBe(html.body);
  });

  it('屬性值裡的 > 不會讓標籤範圍算錯', () => {
    const html = { body: '<img alt="a > b"><p>a &gt; b 這句話</p>' };
    const result = applyChanges(html, [slot(0, '這句話', '那句話')]);
    expect(result.templateData['body']).toBe('<img alt="a > b"><p>a &gt; b 那句話</p>');
  });

  it('after 帶標籤的一律拒絕——Agent 不准直接寫 HTML', () => {
    const html = { body: '<p>今天讀完這本書</p>' };
    const result = applyChanges(html, [slot(0, '這本書', '<strong>這本書</strong>')]);
    expect(result.notFound).toEqual([0]);
    expect(result.templateData['body']).toBe(html.body);
  });

  it('純文字欄位不受標籤規則影響', () => {
    const result = applyChanges({ title: '3 < 5 的證明' }, [slot(0, '證明', '說明')]);
    // title 沒有標籤，但含有 <，所以帶 < 的 after 會被擋——這裡的 after 是純文字，照樣可以套。
    expect(result.templateData['title']).toBe('3 < 5 的說明');
  });

  it('同一個詞在標題與正文都有，改的是正文（正文是最長的欄位）', () => {
    const data = {
      title: '看得見的錯誤',
      body: '<p>制度的錯誤要看得見，錯誤才會便宜。</p>',
    };
    const result = applyChanges(data, [slot(0, '錯誤', '差錯')]);
    expect(result.templateData['title']).toBe('看得見的錯誤');
    expect(result.templateData['body']).toBe('<p>制度的差錯要看得見，錯誤才會便宜。</p>');
  });

  it('只在標題出現的詞照樣改得到標題', () => {
    const data = { title: '看得見的錯誤', body: '<p>一段完全不相干的正文，長度比標題長很多很多。</p>' };
    const result = applyChanges(data, [slot(0, '看得見', '看不見')]);
    expect(result.templateData['title']).toBe('看不見的錯誤');
  });

  it('同一份輸入跑兩次結果一樣（決定性）', () => {
    const slots = [slot(0, '不彷', '不妨'), slot(1, '我覺得', '我認為')];
    expect(applyChanges(base, slots)).toEqual(applyChanges(base, slots));
  });
});

describe('原句找不到、但已經改好了（P5-T017）', () => {
  const data = {
    title: '聖杯與寶劍',
    body: '<p class="wp-block-paragraph">以封建制為基礎的俗世政治，<em>相互競爭</em>、偶有媾和中。</p>',
  };
  const change = (before: string, after: string) => ({ before, after });

  it('before 不在、after 在（標籤外、逐字）→ 已經改好了', () => {
    expect(isAlreadyDone(data, change('以封建制爲基礎的俗世政治', '以封建制為基礎的俗世政治'))).toBe(true);
  });

  it('before 還在就不是', () => {
    expect(isAlreadyDone(data, change('俗世政治', '俗世的政治'))).toBe(false);
  });

  it('after 跨過標籤才對得上就不算——跟套用的定位規則一樣', () => {
    expect(isAlreadyDone(data, change('相互競爭偶有媾和中', '相互競爭、偶有媾和中'))).toBe(false);
  });

  it('after 只出現在標籤屬性裡不算', () => {
    expect(isAlreadyDone(data, change('wp-block-paragrap', 'wp-block-paragraph'))).toBe(false);
  });

  it('after 太短（字母數字不到 6 個）不算', () => {
    expect(isAlreadyDone(data, change('政冶', '政治'))).toBe(false);
  });

  it('標點不算字：「的時侯，→的時候，」只有 3 個字，AI 引用時標點抄錯的話錯字可能還在', () => {
    const text = { body: '<p>那個時候，他說的時候，大家都笑了。</p>' };
    expect(isAlreadyDone(text, change('的時侯，', '的時候，'))).toBe(false);
  });

  it('補逗號的短句：別處剛好有同樣的句子，不能當成改好了', () => {
    // 第二段的錯還在，只是 AI 引用時少了原文的空格，逐字找不到；after 剛好在第一段有。
    const text = { body: '<p>好的，我知道了。</p><p>他說好的 我會去。</p>' };
    expect(isAlreadyDone(text, change('好的我', '好的，我'))).toBe(false);
  });

  it('接在後面補字：before 只出現在 after 裡面，不算「還在」', () => {
    const text = { body: '<p>今天想到很多事情。</p>' };
    expect(isAlreadyDone(text, change('想到很多事', '想到很多事情'))).toBe(true);
  });

  it('在前面補字也一樣', () => {
    const text = { body: '<p>今天想到很多事情。</p>' };
    expect(isAlreadyDone(text, change('很多事情。', '想到很多事情。'))).toBe(true);
  });

  it('別處還有一個獨立的 before，就不是改好了', () => {
    const text = { body: '<p>今天想到很多事情。又想到很多事，</p>' };
    expect(isAlreadyDone(text, change('想到很多事', '想到很多事情'))).toBe(false);
  });

  it('after 是 before 的一部分（刪字）不算', () => {
    expect(isAlreadyDone(data, change('的俗世政治俗世政治', '的俗世政治'))).toBe(false);
  });

  it('before 是空的（純新增）不算', () => {
    expect(isAlreadyDone(data, change('', '以封建制為基礎'))).toBe(false);
  });
});

describe('before 落在 after 裡面不算數（P5-T017 審查）', () => {
  const body = (text: string) => ({ body: `<p class="wp-block-paragraph">${text}</p>` });

  it('接在後面補字：已經是 after 的那句不會被再補一次', () => {
    const result = applyChanges(body('想到很多事情。'), [
      { ordinal: 0, find: '想到很多事', replaceWith: '想到很多事情', skipInside: '想到很多事情' },
    ]);
    expect(result.notFound).toEqual([0]);
    expect(result.templateData['body']).toContain('想到很多事情。');
    expect(result.templateData['body']).not.toContain('事情情');
  });

  it('在前面補字也一樣', () => {
    const result = applyChanges(body('想到很多事情。'), [
      { ordinal: 0, find: '很多事情', replaceWith: '想到很多事情', skipInside: '想到很多事情' },
    ]);
    expect(result.notFound).toEqual([0]);
  });

  it('跳過落在 after 裡的，套到後面那個獨立的 before', () => {
    const result = applyChanges(body('想到很多事情。又想到很多事，'), [
      { ordinal: 0, find: '想到很多事', replaceWith: '想到很多事情', skipInside: '想到很多事情' },
    ]);
    expect(result.replaced).toEqual([0]);
    expect(result.templateData['body']).toContain('想到很多事情。又想到很多事情，');
  });
});
