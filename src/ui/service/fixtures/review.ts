/** 待處理清單：逐項處理、整份採用、丟棄、對照（對應後端 `service/review.ts`）。 */

import { countOpenReviewItems, pendingReviewBlocker } from '../../../contract/review-state.js';
import type { CompareRow, Comparison, DiffSegment, PublisherApi, ReviewResolveResult } from '../types.js';
import { DIARY_BODY, DIARY_MARKS, LONGFORM_BODY, LONGFORM_MARKS } from './data.js';
import { clone, delay, invalidateApproval, mustGet, nextHash, readBody } from './context.js';

/*
 * 對照畫面的示範資料。手寫而不是即時算——比對的程式在後端，前端不重做一份。
 * 三個例子（D-019）：f-reviewed 跟 AI 提案比（改字＋收起來的段落、點觀察卡片會展開），
 * f-rendered 跟上一版比（改字＋新增一段＋改了標籤），f-torn 跟上一版比（正文沒變，只換了封面）。
 */

function sameRow(leftIndex: number, rightIndex: number, text: string): CompareRow {
  const segments: DiffSegment[] = [{ op: 'same', text }];
  return { kind: 'same', leftIndex, rightIndex, left: segments, right: segments, segments, note: null };
}

function replacedRow(leftIndex: number, rightIndex: number, segments: DiffSegment[]): CompareRow {
  return {
    kind: 'replaced',
    leftIndex,
    rightIndex,
    left: segments.filter((segment) => segment.op !== 'added'),
    right: segments.filter((segment) => segment.op !== 'removed'),
    segments,
    note: null,
  };
}

function insertedRow(rightIndex: number, text: string): CompareRow {
  const segments: DiffSegment[] = [{ op: 'added', text }];
  return { kind: 'inserted', leftIndex: null, rightIndex, left: null, right: segments, segments, note: null };
}

/** 示範用的「頂層區塊的純文字」：示範正文一行一個區塊，拿掉標籤就是了。 */
function blockTexts(html: string): string[] {
  return html.split('\n').map((line) => line.replace(/<[^>]+>/g, ''));
}

function diaryComparison(): Comparison {
  const texts = blockTexts(DIARY_BODY);
  return {
    against: 'proposal',
    leftLabel: '目前 r2',
    rightLabel: 'claude 的提案',
    rows: [
      replacedRow(0, 0, [
        { op: 'same', text: '今天讀完這本書，想到很多' },
        { op: 'removed', text: '事' },
        { op: 'added', text: '事情' },
        { op: 'same', text: '。不是書裡寫的那些，而是被書勾起來的、原本以為早就忘掉的片段。' },
      ]),
      replacedRow(1, 1, [
        { op: 'same', text: '下午的雨下得很急，路口的紅燈前積了一小攤水，反射著對面招牌的紅色。我在那裡站了' },
        { op: 'removed', text: '大概' },
        { op: 'same', text: '四十秒，忽然' },
        { op: 'removed', text: '覺得' },
        { op: 'added', text: '意識到' },
        { op: 'same', text: '這種等待其實' },
        { op: 'removed', text: '很難得' },
        { op: 'added', text: '是奢侈的' },
        { op: 'same', text: '。' },
      ]),
      sameRow(2, 2, texts[2]!),
      sameRow(3, 3, texts[3]!),
    ],
    fieldChanges: [],
  };
}

/** 改字＋新增一段＋改了標籤（r2 → r3）。 */
function longformEditsComparison(): Comparison {
  const texts = blockTexts(LONGFORM_BODY);
  // r3 的第 7 段（引文）是這一版新加的，所以 r2 只有 7 段、之後的索引差一。
  return {
    against: 'previous',
    leftLabel: 'r2',
    rightLabel: 'r3',
    rows: [
      sameRow(0, 0, texts[0]!),
      sameRow(1, 1, texts[1]!),
      replacedRow(2, 2, [
        { op: 'same', text: '錯誤本身不貴，貴的是錯誤被藏起來的那段時間。藏得越久，' },
        { op: 'removed', text: '修改' },
        { op: 'added', text: '修正' },
        { op: 'same', text: '的成本就越高，最後往往高到沒有人願意動它。' },
      ]),
      sameRow(3, 3, texts[3]!),
      sameRow(4, 4, texts[4]!),
      sameRow(5, 5, texts[5]!),
      insertedRow(6, texts[6]!),
      sameRow(6, 7, texts[7]!),
    ],
    fieldChanges: [{ field: 'tags', label: '標籤', before: null, after: '隨筆' }],
  };
}

/** 正文一段都沒改，只換了封面（r3 → r4）——使用者那篇 r12 → r13 的樣子。 */
function longformCoverOnlyComparison(): Comparison {
  return {
    against: 'previous',
    leftLabel: 'r3',
    rightLabel: 'r4',
    rows: blockTexts(LONGFORM_BODY).map((text, index) => sameRow(index, index, text)),
    fieldChanges: [
      {
        field: 'featuredMedia',
        label: '精選圖片',
        before: 'old-cover.jpg（回報流程圖）',
        after: 'rainy-crossing.jpg（雨天的路口）',
      },
    ],
  };
}

export const reviewApi: Pick<PublisherApi, 'resolveReview' | 'acceptWholeReview' | 'discardReview' | 'fetchComparison'> = {
  /**
   * 逐項處理。
   *
   * **正文要真的跟著改。** 早期版本只改版本號與 hash，於是示範模式按下「套用」
   * 會看到核准失效、版本 +1，但校樣上一個字都沒變——示範資料的用途就是讓人在
   * 沒有後端的情況下走完流程，會說謊就沒有意義了。
   */
  async resolveReview(uuid: string, input: { itemIds: number[]; decision: 'apply' | 'skip' }) {
    await delay(320);
    const job = mustGet(uuid);
    if (!job.review) throw new Error('這篇稿件沒有待處理的校稿提案');

    const wanted = new Set(input.itemIds);
    const applied: number[] = [];
    const skipped: number[] = [];
    const unappliable: number[] = [];
    const alreadyDone: number[] = [];
    let body = readBody(job);

    job.review.items = job.review.items.map((item) => {
      if (!wanted.has(item.id) || item.state === 'applied') return item;
      if (input.decision === 'skip') {
        skipped.push(item.id);
        return { ...item, state: 'skipped', resolvedAt: new Date().toISOString(), resolvedByEdit: false };
      }
      // 後端是在標籤外面定位的；示範資料的正文都是規規矩矩的段落，
      // 直接換第一個出現的位置就夠像了。找不到時照後端的規則分「已經改好了」與「真的找不到」
      // （簡化版：不檢查長度與刪字，示範資料用不到）。
      if (item.change && !body.includes(item.change.before)) {
        if (body.includes(item.change.after)) {
          alreadyDone.push(item.id);
          return { ...item, state: 'skipped', alreadyDone: true };
        }
        unappliable.push(item.id);
        return { ...item, state: 'unappliable' };
      }
      if (item.change) body = body.replace(item.change.before, item.change.after);
      applied.push(item.id);
      return { ...item, state: 'applied', resolvedAt: new Date().toISOString() };
    });

    if (applied.length > 0 && job.currentRevision) {
      invalidateApproval(job, '套用了校稿建議');
      job.marks = job.target.key === 'diary' ? DIARY_MARKS : LONGFORM_MARKS;
      job.currentRevision = {
        ...job.currentRevision,
        number: job.currentRevision.number + 1,
        contentHash: nextHash().padEnd(64, '0'),
        templateData: { ...job.currentRevision.templateData, body },
        publishHtml: body,
      };
      job.revisionCount += 1;
      job.review.baseContentHash = job.currentRevision.contentHash;
    }

    job.review.pendingCount = countOpenReviewItems(job.review.items);
    if (job.review.pendingCount === 0) job.review = null;
    job.blockers = job.review ? [pendingReviewBlocker(job.review.pendingCount)] : [];

    return {
      revision: applied.length > 0 ? clone(job.currentRevision) : null,
      applied,
      skipped,
      unappliable,
      alreadyDone,
      review: clone(job.review),
    } satisfies ReviewResolveResult;
  },

  async acceptWholeReview(uuid: string, proposalId: number) {
    await delay(320);
    const job = mustGet(uuid);
    if (!job.review) throw new Error('這篇稿件沒有待處理的校稿提案');
    if (job.review.id !== proposalId) throw new Error('這份校稿建議已經被另一次校稿取代了');
    if (job.review.stale) throw new Error('內容在這次校稿之後被改過了，請改用逐項套用');

    const changeIds = job.review.items.filter((item) => item.type === 'change').map((item) => item.id);
    // 明寫 reviewApi 不用 this：呼叫端是透過 client.ts 的 Proxy 取到這個函式的，
    // this 綁到誰要看呼叫方式，不該去賭。
    return reviewApi.resolveReview(uuid, { itemIds: changeIds, decision: 'apply' });
  },

  async discardReview(uuid: string, _reason: string, proposalId: number) {
    await delay(150);
    const job = mustGet(uuid);
    if (job.review && job.review.id !== proposalId) {
      throw new Error('這份校稿建議已經被另一次校稿取代了');
    }
    job.review = null;
    job.blockers = [];
  },

  async fetchComparison(uuid: string) {
    await delay(200);
    const job = mustGet(uuid);
    if (job.review) return { ...diaryComparison(), rightLabel: `${job.review.provider} 的提案` };
    if (uuid === 'f-rendered') return longformEditsComparison();
    if (uuid === 'f-torn') return longformCoverOnlyComparison();
    return { against: 'none', leftLabel: '', rightLabel: '', rows: [], fieldChanges: [] } satisfies Comparison;
  },
};
