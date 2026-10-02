/**
 * 示範資料的內容本身：發布目標、正文、校對符號、待處理清單、配圖需求、版本。
 * 只有資料與組資料的小函式，沒有規則（P5-T033）。
 */

import { excerptAfterChanges } from '../../../contract/review-locate.js';
import type { ImageBrief, MediaAsset, ProofMark, PublishTargetSummary, ReviewItem, ReviewProposal, Revision } from '../types.js';

export const DIARY_TARGET: PublishTargetSummary = {
  key: 'diary',
  displayName: '日•記',
  contentType: 'diary',
  postType: 'diary',
  templateId: 'diary-v1',
  taxonomy: 'diary-category',
  requireFeaturedImage: false,
  allowCreateTerms: false,
  disabled: false,
};

export const LONGFORM_TARGET: PublishTargetSummary = {
  key: 'read-think',
  displayName: '思想•讀•鑰（長文）',
  contentType: 'longform',
  postType: 'read-think',
  templateId: 'longform-v1',
  taxonomy: 'read-think-tag',
  requireFeaturedImage: true,
  allowCreateTerms: false,
  disabled: false,
};

/** 通用站台（D-016）：同一個 article-v1 模板發文章與頁面。示範資料裡跟作者站台並列，只是為了兩種都看得到。 */
export const POST_TARGET: PublishTargetSummary = {
  key: 'post',
  displayName: '文章',
  contentType: 'article',
  postType: 'post',
  templateId: 'article-v1',
  taxonomy: 'category',
  requireFeaturedImage: false,
  allowCreateTerms: false,
  disabled: false,
};

export const PAGE_TARGET: PublishTargetSummary = {
  key: 'page',
  displayName: '頁面',
  contentType: 'article',
  postType: 'page',
  templateId: 'article-v1',
  taxonomy: null,
  requireFeaturedImage: false,
  allowCreateTerms: false,
  disabled: false,
};

/** 模板允許的正文標籤（照 templates 底下各模板的 manifest.json 抄；示範資料沒有後端可以問）。 */
export const TEMPLATE_TAGS = ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'blockquote', 'figure', 'figcaption', 'img', 'br', 'hr'];
export const TEMPLATE_SCHEMES = ['https', 'http', 'mailto'];

/** 只用核心區塊、沒有字級 class：通用模板不帶任何佈景主題設定。 */
export const ARTICLE_BODY = [
  '<p>第一次架站的人最常問的問題，不是「要用哪個佈景主題」，而是「文章要怎麼寫才不會亂」。</p>',
  '<h2 class="wp-block-heading">先決定一篇只講一件事</h2>',
  '<p>標題講得出來的，正文才講得清楚。講不出來，通常是還沒想好。</p>',
  '<ul class="wp-block-list"><li>一段一個重點。</li><li>小標只用兩層。</li><li>圖片放在它說明的段落後面。</li></ul>',
  '<blockquote class="wp-block-quote"><p>寫清楚是對讀者的禮貌。</p></blockquote>',
].join('\n');

export const DIARY_BODY = [
  '<p class="wp-block-paragraph has-medium-font-size">今天讀完這本書，想到很多事。不是書裡寫的那些，而是被書勾起來的、原本以為早就忘掉的片段。</p>',
  '<p class="wp-block-paragraph has-medium-font-size">下午的雨下得很急，路口的紅燈前積了一小攤水，反射著對面招牌的紅色。我在那裡站了大概四十秒，忽然覺得這種等待其實很難得。</p>',
  '<p class="wp-block-paragraph has-medium-font-size">晚上把去年的筆記翻出來對照，發現當時擔心的事情有八成都沒有發生。剩下的兩成也不是用擔心解決的。</p>',
  '<p class="wp-block-paragraph has-medium-font-size">明天要早起。就先寫到這裡。</p>',
].join('\n');

export const LONGFORM_BODY = [
  '<p class="wp-block-paragraph has-medium-font-size">一個制度要活下來，靠的不是設計得多精巧，而是它出錯的時候有沒有辦法被人看見、被人修正。這句話聽起來像常識，但真正照著做的組織非常少。</p>',
  '<h3 class="wp-block-heading has-medium-font-size"><strong>看得見的錯誤才是便宜的錯誤</strong></h3>',
  '<p class="wp-block-paragraph has-medium-font-size">錯誤本身不貴，貴的是錯誤被藏起來的那段時間。藏得越久，修正的成本就越高，最後往往高到沒有人願意動它。</p>',
  '<ul class="wp-block-list"><li>第一，讓錯誤浮出水面的機制要比追究責任的機制更早存在。</li><li>第二，回報錯誤的人不能因此付出代價。</li><li>第三，修正必須看得到結果，否則下一次沒有人會再回報。</li></ul>',
  '<h3 class="wp-block-heading has-medium-font-size"><strong>把判斷留給最靠近現場的人</strong></h3>',
  '<p class="wp-block-paragraph has-medium-font-size">距離會過濾掉細節。越往上走，看到的東西越整齊，也越失真。真正的資訊密度在現場，而現場的人通常沒有決定權。</p>',
  '<blockquote class="wp-block-quote"><p>制度的品質，等於它承認自己會錯的程度。</p></blockquote>',
  '<p class="wp-block-paragraph has-medium-font-size">所以問題從來不是「怎麼不要犯錯」，而是「錯了以後多快會知道」。</p>',
].join('\n');

/** 32×18 的灰色 PNG（16:9）。示範資料不去抓網路上的圖，也不引用外部網址。 */
export const GREY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAAH0lEQVR42mO4cfUcTRHDqAWjFoxaMGrBqAWjFtDDAgB9mZUMH5wChwAAAABJRU5ErkJggg==';

export function media(id: number, alt: string, uploaded = true): MediaAsset {
  return {
    id,
    jobId: 1,
    mimeType: 'image/png',
    byteSize: 184_320 + id * 4_096,
    sha256: `${id}`.padStart(64, '0'),
    width: 1600,
    height: 900,
    altText: alt,
    caption: null,
    briefKey: null,
    wordpressMediaId: uploaded ? 900 + id : null,
    // 這是 WordPress 的公開網址，不是本機縮圖。還沒上傳成功時就是 null。
    url: uploaded ? GREY_PNG : null,
    placed: false,
    placedAfterBlockIndex: null,
    featured: false,
    createdAt: '2026-08-28T09:12:00Z',
  };
}

export const DIARY_MARKS: ProofMark[] = [
  {
    blockIndex: 0,
    kind: 'replaced',
    glyph: '～',
    summary: '補上逗號，句子拆得更好讀',
    before: '今天讀完這本書想到很多事不是書裡寫的那些',
    after: '今天讀完這本書，想到很多事。不是書裡寫的那些，',
  },
  {
    blockIndex: 1,
    kind: 'inserted',
    glyph: '＋',
    summary: '補一句說明雨勢，前後才接得上',
    before: null,
    after: '下午的雨下得很急，',
  },
  {
    blockIndex: 2,
    kind: 'replaced',
    glyph: '～',
    summary: '「都沒發生」改成「都沒有發生」，與全文語氣一致',
    before: '有八成都沒發生',
    after: '有八成都沒有發生',
  },
  {
    blockIndex: 3,
    kind: 'deleted',
    glyph: '－',
    summary: '刪掉重複的收尾句',
    before: '總之明天要早起。明天要早起。',
    after: null,
  },
];

export const LONGFORM_MARKS: ProofMark[] = [
  {
    blockIndex: 0,
    kind: 'replaced',
    glyph: '～',
    summary: '開頭改為主動式，主詞提前',
    before: '一個制度能不能活下來，是取決於它的設計精巧程度的',
    after: '一個制度要活下來，靠的不是設計得多精巧',
  },
  {
    blockIndex: 3,
    kind: 'moved',
    glyph: '⇄',
    summary: '清單第二點與第三點對調，因果順序才對',
    before: '修正必須看得到結果 → 回報的人不能付出代價',
    after: '回報的人不能付出代價 → 修正必須看得到結果',
  },
  {
    blockIndex: 6,
    kind: 'inserted',
    glyph: '＋',
    summary: '補上引言，把上一節的結論收起來',
    before: null,
    after: '制度的品質，等於它承認自己會錯的程度。',
  },
];

/**
 * 示範用的待處理清單。
 *
 * 刻意混了三種：安全的錯字、自承改了原意的（要標紅且預設不勾）、以及一個
 * 只能請人判斷的觀察。少了任何一種，清單的樣子就練不到。
 */
export function reviewItem(
  id: number,
  ordinal: number,
  partial: Pick<ReviewItem, 'type' | 'change' | 'observation' | 'blockIndex'> & Partial<Pick<ReviewItem, 'locatedText'>>,
  state: ReviewItem['state'] = 'pending',
  alreadyDone = false,
): ReviewItem {
  // 後端讀取時算的 `locatedText`；示範資料沒寫的給 null，畫面退回卡片引用的字（照舊）。
  return { id, ordinal, state, resolvedAt: null, resolvedByEdit: false, alreadyDone, locatedText: null, ...partial };
}

const TYPO_WRITTEN = {
  type: 'typo' as const,
  before: '就先寫道這裡',
  after: '就先寫到這裡',
  reason: '「寫道」是「寫到」的錯字',
  meaningChanged: false,
};

const OBS_EARLY = {
  kind: 'gap' as const,
  blockIndex: 3,
  excerpt: '明天要早起。就先寫道這裡',
  detail: '最後一段突然收尾，沒交代為什麼要早起。',
  suggestion: '補半句早起要做什麼，或保留這種戛然而止的語氣。',
};

export function diaryReview(): ReviewProposal {
  return {
    id: 501,
    provider: 'claude',
    summary: '三處標點與一個前後對不上的地方',
    createdAt: '2026-08-28T09:39:10Z',
    baseContentHash: '5c02f7ab91de4460'.padEnd(64, '0'),
    stale: false,
    pendingCount: 8,
    items: [
      reviewItem(9001, 0, {
        type: 'change',
        blockIndex: 0,
        change: {
          type: 'typo',
          before: '想到很多事',
          after: '想到很多事情',
          reason: '句子讀起來斷得太快',
          meaningChanged: false,
        },
        observation: null,
      }),
      reviewItem(9002, 1, {
        type: 'change',
        blockIndex: 1,
        change: {
          type: 'style',
          before: '我在那裡站了大概四十秒',
          after: '我在那裡站了四十秒',
          reason: '「大概」與具體秒數互相矛盾',
          meaningChanged: false,
        },
        observation: null,
      }),
      reviewItem(9003, 2, {
        type: 'change',
        blockIndex: 1,
        change: {
          type: 'clarity',
          before: '忽然覺得這種等待其實很難得',
          after: '忽然意識到這種等待其實是奢侈的',
          reason: '「難得」偏中性，這裡想表達的更接近珍惜',
          meaningChanged: true,
        },
        observation: null,
      }),
      reviewItem(9004, 3, {
        type: 'observation',
        blockIndex: 2,
        change: null,
        observation: {
          kind: 'contradiction',
          blockIndex: 2,
          excerpt: '有八成都沒有發生',
          detail: '第 1 段說「想到很多事」，第 3 段說擔心的事八成沒發生，兩處指的是不是同一批事情沒有交代。',
          suggestion: '確認這兩段講的是不是同一件事，或補一句把它們接起來。',
        },
      }),
      // 真的找不到（P5-T017）：AI 引用時把「筆記」寫成「日記」，文章裡沒有這句。
      reviewItem(
        9005,
        4,
        {
          type: 'change',
          blockIndex: null,
          change: {
            type: 'typo',
            before: '把去年的日記翻出來對照',
            after: '把去年的日記本翻出來對照',
            reason: '「日記」指的是一本本子，補上「本」比較清楚',
            meaningChanged: false,
          },
          observation: null,
        },
        'unappliable',
      ),
      // 已經改好了（P5-T017）：原句找不到，但文章裡已經是改好的樣子。後端讀取時算出來的，
      // 示範資料直接給結果。
      reviewItem(
        9006,
        5,
        {
          type: 'change',
          blockIndex: 2,
          change: {
            type: 'grammar',
            before: '有八成都沒發生',
            after: '有八成都沒有發生',
            reason: '與全文語氣一致',
            meaningChanged: false,
          },
          observation: null,
        },
        'skipped',
        true,
      ),
      // 講標題的觀察（P5-T031）：沒有段落、字在標題裡；按「去原文改」游標要跳到標題。
      reviewItem(9007, 6, {
        type: 'observation',
        blockIndex: null,
        change: null,
        observation: {
          kind: 'gap',
          // Agent 自己填的段落；後端在正文裡找不到「20260828」，讀取時重算成 null。
          blockIndex: 0,
          excerpt: '20260828',
          detail: '標題是日期「20260828」，正文說「今天讀完這本書」，沒辦法確認這是不是寫這篇的那一天。',
          suggestion: '日期不對就直接改標題。',
        },
      }),
      // P5-T037：同一份校稿裡改錯字的那條已接受（文章裡現在是「寫到」）……
      reviewItem(
        9008,
        7,
        { type: 'change', blockIndex: 3, change: TYPO_WRITTEN, observation: null, locatedText: TYPO_WRITTEN.after },
        'applied',
      ),
      // ……另一條觀察引用的是改之前的字。後端拿已套用的那條對應過再找，示範資料用同一個契約函式算字、段落寫死。
      reviewItem(9009, 8, {
        type: 'observation',
        blockIndex: 3,
        change: null,
        observation: OBS_EARLY,
        locatedText: excerptAfterChanges(OBS_EARLY.excerpt, [TYPO_WRITTEN]),
      }),
      // 哪裡都找不到的觀察：按「去原文改」，游標放文章開頭，頂端要明講找不到（P5-T037）。
      reviewItem(9010, 9, {
        type: 'observation',
        blockIndex: null,
        change: null,
        observation: {
          kind: 'missing-source',
          blockIndex: 1,
          excerpt: '把雨傘忘在公車上',
          detail: '這件事前後文都沒有交代。',
          suggestion: '補一句發生在哪裡，或拿掉。',
        },
      }),
    ],
  };
}

/** 示範用的配圖需求。這裡不生圖，只給「該配什麼圖」與可以直接貼去生圖的 prompt。 */
export function diaryBriefs(): ImageBrief[] {
  return [
    {
      id: 601,
      key: 'rainy_crossing',
      purpose: '第二段的雨天路口，給讀者一個具體的畫面落腳',
      prompt:
        '台北街頭的雨天路口，柏油路積著一小攤水，水面反射對面招牌的紅光；黃昏、細雨、'
        + '沒有人物入鏡；寫實攝影風格，淺景深，冷色調中帶一點暖紅。',
      aspectRatio: '16:9',
      altText: '雨天路口積水處反射著紅色招牌的燈光',
      caption: null,
      placement: '第 2 段之後',
      anchor: '路口的紅燈前積了一小攤水',
      fulfilled: false,
      dismissed: false,
      createdAt: '2026-08-28T09:41:00Z',
      isFeatured: false,
      candidate: null,
      origin: 'agent',
      anchorPosition: 'after',
      note: null,
      promptEdited: false,
    },
    {
      id: 602,
      key: 'old_notebook',
      purpose: '第三段翻舊筆記的動作，收束整篇的回望感',
      prompt:
        '攤開的舊筆記本放在木桌上，紙頁泛黃、有手寫字跡但看不清內容；桌燈側光，'
        + '安靜的室內夜晚；寫實攝影風格，俯角。',
      aspectRatio: '4:3',
      altText: '木桌上攤開一本泛黃的舊筆記本',
      caption: '去年的筆記',
      placement: '第 3 段之後',
      // 故意對不上：AI 引用時把「筆記」寫成「日記」。練「找不到建議的位置」那條路（P5-T016）。
      anchor: '把去年的日記翻出來對照',
      fulfilled: false,
      dismissed: false,
      createdAt: '2026-08-28T09:41:00Z',
      isFeatured: false,
      candidate: null,
      origin: 'agent',
      anchorPosition: 'after',
      note: null,
      promptEdited: false,
    },
  ];
}

/**
 * 長文的配圖需求：一張封面、一張內文圖。長文一定要有精選圖片，所以「生圖 → 用這張 →
 * 自動設精選」這條路在 f-media 這篇上走得完。
 */
export function longformBriefs(): ImageBrief[] {
  return [
    {
      id: 611,
      key: 'featured',
      purpose: '精選圖片，呼應「錯了以後多快會知道」的主題',
      prompt:
        '一盞在霧裡亮著的紅色警示燈，遠處有模糊的人影朝它走過去；清晨、薄霧、冷色調，'
        + '只有警示燈是暖紅色；寫實攝影風格，留白多，適合當橫幅封面。',
      aspectRatio: '16:9',
      altText: '霧中亮著的紅色警示燈，遠處有人影走近',
      caption: null,
      placement: '精選圖片',
      anchor: null,
      fulfilled: false,
      dismissed: false,
      createdAt: '2026-08-28T10:05:00Z',
      isFeatured: true,
      candidate: null,
      origin: 'agent',
      anchorPosition: 'after',
      note: null,
      promptEdited: false,
    },
    {
      id: 612,
      key: 'report_loop',
      purpose: '第一個小節的三點清單：回報、不追究、看得到結果',
      prompt: '三個圓圈首尾相連成一個循環的簡潔示意圖，扁平插畫風格，米白底、墨綠線條，不要任何文字。',
      aspectRatio: '4:3',
      altText: '三個步驟首尾相連形成循環的示意圖',
      caption: '回報的循環',
      placement: '第 4 段之後',
      anchor: '修正必須看得到結果',
      fulfilled: false,
      dismissed: false,
      createdAt: '2026-08-28T10:05:00Z',
      isFeatured: false,
      candidate: null,
      origin: 'agent',
      anchorPosition: 'after',
      note: null,
      promptEdited: false,
    },
  ];
}

export function revision(
  number: number,
  origin: Revision['origin'],
  data: Record<string, unknown>,
  hash: string,
): Revision {
  return {
    id: 1000 + number,
    number,
    origin,
    contentHash: hash.padEnd(64, '0'),
    templateData: data,
    featuredMediaId: null,
    publishHtml: typeof data['body'] === 'string' ? data['body'] : '',
    createdAt: '2026-08-28T09:40:00Z',
  };
}

/**
 * AI 查證的示範稿件（P6-T005）：一篇講《刺激1995》的文章，句句都是查得到（或查不到）的說法。
 * 頂層區塊：0 段落、1 段落、2 小標、3 段落、4 段落、5 段落。查證結果的 `blockIndex` 照這個寫死（`fixtures/factcheck.ts`）。
 */
export const FACTCHECK_BODY = [
  '<p>《刺激1995》是法蘭克・戴拉邦特執導的電影，這部片 1995 年上映，改編自史蒂芬・金的中篇小說。</p>',
  '<p>它上映時票房並不好，北美首輪只收了大約一千六百萬美元，後來靠錄影帶出租才慢慢累積口碑。</p>',
  '<h2 class="wp-block-heading">為什麼現在還有人重看</h2>',
  '<p>片中的肖申克監獄其實是俄亥俄州一座已經關閉的感化院，現在開放參觀。</p>',
  '<p>導演當年只花了五千美元就買下改編權。</p>',
  '<p>研究顯示，重看喜歡的電影能降低焦慮。</p>',
].join('\n');

/** 查證示範稿件上的校稿提案：一張「沒有依據」的觀察卡片，練「查證」按鈕（跟一條查證結果引同一句）。 */
export function factcheckReview(): ReviewProposal {
  return {
    id: 520,
    provider: 'claude',
    summary: '一個沒有依據的說法',
    createdAt: '2026-09-30T08:00:00Z',
    baseContentHash: 'a0c4e2f19b7d3c55'.padEnd(64, '0'),
    stale: false,
    pendingCount: 2,
    items: [
      reviewItem(9201, 0, {
        type: 'observation',
        blockIndex: 5,
        change: null,
        observation: {
          kind: 'unsupported-claim',
          blockIndex: 5,
          excerpt: '研究顯示，重看喜歡的電影能降低焦慮',
          detail: '「研究顯示」沒有說是哪一份研究，讀者沒辦法自己去看。',
          suggestion: '補上研究的出處，或改成自己的感受。',
        },
      }),
      reviewItem(9202, 1, {
        type: 'observation',
        blockIndex: 4,
        change: null,
        observation: {
          kind: 'missing-source',
          blockIndex: 4,
          excerpt: '只花了五千美元就買下改編權',
          detail: '金額這種細節最好標出處。',
          suggestion: '補一個連結。',
        },
      }),
    ],
  };
}
