import { findIgnoringSpaces } from '../../contract/text-match.js';
import { hasWpImageClass } from '../../contract/media-marker.js';
import { normalizeUserNote, USER_NOTE_MAX, userNoteLength } from '../../contract/user-note.js';
import type {
  AddMediaInput,
  AuthorOption,
  AuthorsResponse,
  AutoPlaceResult,
  AgentReviewInput,
  AgentRunResult,
  Approval,
  CompareRow,
  Comparison,
  DiffSegment,
  CreateJobInput,
  CreateRevisionInput,
  JobDetail,
  JobSummary,
  ImageCandidate,
  ImageGenerationStatus,
  MediaAsset,
  MediaUploadResult,
  ProofMark,
  PublishTargetSummary,
  PublisherApi,
  PublishInput,
  PublishResult,
  RenderOutcome,
  Revision,
  ImageBrief,
  ReviewItem,
  ReviewProposal,
  ReviewResolveResult,
  SetupAgent,
  SetupCheck,
  SetupConnectionResult,
  SetupProblem,
  SetupProblemKind,
  Term,
} from './types.js';

/** 契約的欄位都是 readonly（讀到的資料）；示範資料扮演後端，得能改自己的狀態。 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** 示範資料多帶兩個欄位，因為 JobSummary 需要而 JobDetail 沒有。 */
interface FixtureJob extends Writable<Omit<JobDetail, 'target' | 'review'>> {
  target: PublishTargetSummary;
  review: Writable<ReviewProposal> | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 示範資料。
 *
 * 後端是平行開發的，所以每個畫面與每個狀態都要能在沒有後端的情況下走一遍——
 * 尤其是「印章被撕掉」這種很難在真實流程裡湊出來的狀態。
 *
 * 加 `?fixtures=1` 開啟。開啟時畫面上方永遠掛一條橫幅，不會有人把示範資料
 * 誤認成真的稿件。
 */

const DIARY_TARGET: PublishTargetSummary = {
  key: 'diary',
  displayName: '日•記',
  contentType: 'diary',
  postType: 'diary',
  templateId: 'diary-v1',
  taxonomy: 'diary-category',
  requireFeaturedImage: false,
  allowCreateTerms: false,
};

const LONGFORM_TARGET: PublishTargetSummary = {
  key: 'read-think',
  displayName: '思想•讀•鑰（長文）',
  contentType: 'longform',
  postType: 'read-think',
  templateId: 'longform-v1',
  taxonomy: 'read-think-tag',
  requireFeaturedImage: true,
  allowCreateTerms: false,
};

/** 通用站台（D-016）：同一個 article-v1 模板發文章與頁面。示範資料裡跟作者站台並列，只是為了兩種都看得到。 */
const POST_TARGET: PublishTargetSummary = {
  key: 'post',
  displayName: '文章',
  contentType: 'article',
  postType: 'post',
  templateId: 'article-v1',
  taxonomy: 'category',
  requireFeaturedImage: false,
  allowCreateTerms: false,
};

const PAGE_TARGET: PublishTargetSummary = {
  key: 'page',
  displayName: '頁面',
  contentType: 'article',
  postType: 'page',
  templateId: 'article-v1',
  taxonomy: null,
  requireFeaturedImage: false,
  allowCreateTerms: false,
};

/** 只用核心區塊、沒有字級 class：通用模板不帶任何佈景主題設定。 */
const ARTICLE_BODY = [
  '<p>第一次架站的人最常問的問題，不是「要用哪個佈景主題」，而是「文章要怎麼寫才不會亂」。</p>',
  '<h2 class="wp-block-heading">先決定一篇只講一件事</h2>',
  '<p>標題講得出來的，正文才講得清楚。講不出來，通常是還沒想好。</p>',
  '<ul class="wp-block-list"><li>一段一個重點。</li><li>小標只用兩層。</li><li>圖片放在它說明的段落後面。</li></ul>',
  '<blockquote class="wp-block-quote"><p>寫清楚是對讀者的禮貌。</p></blockquote>',
].join('\n');

const DIARY_BODY = [
  '<p class="wp-block-paragraph has-medium-font-size">今天讀完這本書，想到很多事。不是書裡寫的那些，而是被書勾起來的、原本以為早就忘掉的片段。</p>',
  '<p class="wp-block-paragraph has-medium-font-size">下午的雨下得很急，路口的紅燈前積了一小攤水，反射著對面招牌的紅色。我在那裡站了大概四十秒，忽然覺得這種等待其實很難得。</p>',
  '<p class="wp-block-paragraph has-medium-font-size">晚上把去年的筆記翻出來對照，發現當時擔心的事情有八成都沒有發生。剩下的兩成也不是用擔心解決的。</p>',
  '<p class="wp-block-paragraph has-medium-font-size">明天要早起。就先寫到這裡。</p>',
].join('\n');

const LONGFORM_BODY = [
  '<p class="wp-block-paragraph has-medium-font-size">一個制度要活下來，靠的不是設計得多精巧，而是它出錯的時候有沒有辦法被人看見、被人修正。這句話聽起來像常識，但真正照著做的組織非常少。</p>',
  '<h3 class="wp-block-heading has-medium-font-size"><strong>看得見的錯誤才是便宜的錯誤</strong></h3>',
  '<p class="wp-block-paragraph has-medium-font-size">錯誤本身不貴，貴的是錯誤被藏起來的那段時間。藏得越久，修正的成本就越高，最後往往高到沒有人願意動它。</p>',
  '<ul class="wp-block-list"><li>第一，讓錯誤浮出水面的機制要比追究責任的機制更早存在。</li><li>第二，回報錯誤的人不能因此付出代價。</li><li>第三，修正必須看得到結果，否則下一次沒有人會再回報。</li></ul>',
  '<h3 class="wp-block-heading has-medium-font-size"><strong>把判斷留給最靠近現場的人</strong></h3>',
  '<p class="wp-block-paragraph has-medium-font-size">距離會過濾掉細節。越往上走，看到的東西越整齊，也越失真。真正的資訊密度在現場，而現場的人通常沒有決定權。</p>',
  '<blockquote class="wp-block-quote"><p>制度的品質，等於它承認自己會錯的程度。</p></blockquote>',
  '<p class="wp-block-paragraph has-medium-font-size">所以問題從來不是「怎麼不要犯錯」，而是「錯了以後多快會知道」。</p>',
].join('\n');

/** 模擬 buildPreviewDocument 的輸出：自成一份文件、樣式內嵌、正文在 .preview-body。 */
function previewDocument(job: JobDetail): string {
  const data = job.currentRevision?.templateData ?? {};
  const title = typeof data['title'] === 'string' ? data['title'] : (job.title ?? '未命名');
  const body = typeof data['body'] === 'string' ? data['body'] : '<p>（尚未渲染）</p>';
  const featured = job.media.find((asset) => asset.id === job.featuredMediaId);
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<style>
:root { color-scheme: light; }
body { margin:0; background:#fff; }
.preview-article { max-width:46rem; margin:0 auto; padding:2rem 1.25rem 4rem;
  font-family:'PingFang TC','Noto Sans TC',system-ui,sans-serif; font-size:1.0625rem;
  line-height:1.9; color:#23262b; }
.preview-frame { border:1px dashed #c8ccd4; border-radius:.5rem; padding:1.25rem 1.25rem 1rem;
  margin-bottom:2.5rem; background:#f7f8fa; }
.preview-frame-note { margin:0 0 1rem; font-size:.75rem; letter-spacing:.04em; color:#8a9099;
  text-transform:uppercase; }
.preview-featured img { width:100%; height:auto; border-radius:.375rem; display:block; }
.preview-title { font-size:1.6rem; line-height:1.4; margin:1rem 0 .5rem; color:#14161a; font-weight:700; }
.preview-meta { margin:0; font-size:.85rem; color:#6b7280; }
.preview-body > :first-child { margin-top:0; }
.preview-body p { margin:0 0 1.5rem; }
.preview-body h3 { font-size:1.25rem; line-height:1.5; margin:2.75rem 0 1rem; color:#14161a; }
.preview-body ul { margin:0 0 1.5rem; padding-left:1.5rem; }
.preview-body li { margin-bottom:.5rem; }
.preview-body blockquote { margin:0 0 1.5rem; padding:.25rem 0 .25rem 1.25rem;
  border-left:3px solid #d6dae1; color:#4b5563; }
.preview-body figure { margin:2rem 0; }
.preview-body figure img { width:100%; height:auto; display:block; border-radius:.25rem; }
</style></head>
<body><article class="preview-article">
<header class="preview-frame" aria-label="佈景主題外框（不會發布）">
<p class="preview-frame-note">以下外框由網站佈景主題產生，發布台不會送出</p>
${featured ? `<figure class="preview-featured"><img src="${featured.url ?? ''}" alt="${featured.altText ?? ''}"></figure>` : ''}
<h1 class="preview-title">${title}</h1>
<p class="preview-meta">2026 年 8 月 28 日</p>
</header>
<div class="preview-body" aria-label="正文（會發布的內容）">
${body}
</div>
</article></body></html>`;
}

/** 32×18 的灰色 PNG（16:9）。示範資料不去抓網路上的圖，也不引用外部網址。 */
const GREY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAAH0lEQVR42mO4cfUcTRHDqAWjFoxaMGrBqAWjFtDDAgB9mZUMH5wChwAAAABJRU5ErkJggg==';

function media(id: number, alt: string, uploaded = true): MediaAsset {
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

const DIARY_MARKS: ProofMark[] = [
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

const LONGFORM_MARKS: ProofMark[] = [
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
function reviewItem(
  id: number,
  ordinal: number,
  partial: Pick<ReviewItem, 'type' | 'change' | 'observation' | 'blockIndex'>,
  state: ReviewItem['state'] = 'pending',
  alreadyDone = false,
): ReviewItem {
  return { id, ordinal, state, resolvedAt: null, resolvedByEdit: false, alreadyDone, ...partial };
}

function diaryReview(): ReviewProposal {
  return {
    id: 501,
    provider: 'claude',
    summary: '三處標點與一個前後對不上的地方',
    createdAt: '2026-08-28T09:39:10Z',
    baseContentHash: '5c02f7ab91de4460'.padEnd(64, '0'),
    stale: false,
    pendingCount: 5,
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
    ],
  };
}

/** 示範用的配圖需求。這裡不生圖，只給「該配什麼圖」與可以直接貼去生圖的 prompt。 */
function diaryBriefs(): ImageBrief[] {
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
    },
  ];
}

/**
 * 長文的配圖需求：一張封面、一張內文圖。長文一定要有精選圖片，所以「生圖 → 用這張 →
 * 自動設精選」這條路在 f-media 這篇上走得完。
 */
function longformBriefs(): ImageBrief[] {
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
    },
  ];
}

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

function revision(
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

function baseDiary(uuid: string, overrides: Partial<FixtureJob>): FixtureJob {
  return {
    uuid,
    state: 'SOURCE',
    title: '20260828',
    target: DIARY_TARGET,
    template: { id: 'diary-v1', hash: '9f2c41ab7d6e0c53', strictness: 'flexible' },
    currentRevision: revision(1, 'source', { title: '20260828', slug: '20260828', body: DIARY_BODY }, '3a91c0d4e8b25f77'),
    revisionCount: 1,
    previewUrl: `/api/jobs/${uuid}/preview`,
    marks: [],
    media: [],
    featuredMediaId: null,
    approval: null,
    blockers: [],
    published: null,
    agentRun: null,
    review: null,
    imageBriefs: [],
    sourceText: '今天讀完這本書想到很多事……',
    createdAt: '2026-08-28T09:05:00Z',
    updatedAt: '2026-08-28T09:40:00Z',
    ...overrides,
  };
}

function baseLongform(uuid: string, overrides: Partial<FixtureJob>): FixtureJob {
  return {
    uuid,
    state: 'RENDERED',
    title: '看得見的錯誤',
    target: LONGFORM_TARGET,
    template: { id: 'longform-v1', hash: '41d7be092ca6f318', strictness: 'hybrid' },
    currentRevision: revision(
      3,
      'agent_review',
      { title: '看得見的錯誤', slug: 'visible-mistakes', body: LONGFORM_BODY, tags: ['隨筆'] },
      'b7e4290ac1f6d835',
    ),
    revisionCount: 3,
    previewUrl: `/api/jobs/${uuid}/preview`,
    marks: LONGFORM_MARKS,
    media: [{ ...media(41, '雨天的路口'), featured: true }],
    featuredMediaId: 41,
    approval: null,
    blockers: [],
    published: null,
    agentRun: null,
    review: null,
    imageBriefs: [],
    sourceText: null,
    createdAt: '2026-08-27T14:00:00Z',
    updatedAt: '2026-08-28T10:02:00Z',
    ...overrides,
  };
}

function baseArticle(uuid: string, overrides: Partial<FixtureJob>): FixtureJob {
  return {
    uuid,
    state: 'RENDERED',
    title: '文章要怎麼寫才不會亂',
    target: POST_TARGET,
    template: { id: 'article-v1', hash: 'c3f81d2a0b9e4476', strictness: 'hybrid' },
    currentRevision: revision(
      1,
      'source',
      { title: '文章要怎麼寫才不會亂', body: ARTICLE_BODY, category: '教學' },
      'e1a7c9340f5d2b68',
    ),
    revisionCount: 1,
    previewUrl: `/api/jobs/${uuid}/preview`,
    marks: [],
    media: [],
    featuredMediaId: null,
    approval: null,
    blockers: ['還沒核准'],
    published: null,
    agentRun: null,
    review: null,
    imageBriefs: [],
    sourceText: '第一次架站的人最常問的問題……',
    createdAt: '2026-09-23T08:00:00Z',
    updatedAt: '2026-09-23T08:10:00Z',
    ...overrides,
  };
}

function buildStore(): Map<string, FixtureJob> {
  const jobs: FixtureJob[] = [
    baseDiary('f-source', { state: 'SOURCE', blockers: ['還沒渲染，先按「渲染」產生校樣'] }),
    baseDiary('f-reviewed', {
      state: 'REVIEWED',
      marks: DIARY_MARKS,
      currentRevision: revision(2, 'agent_review', { title: '20260828', slug: '20260828', body: DIARY_BODY }, '5c02f7ab91de4460'),
      agentRun: {
        status: 'succeeded',
        provider: 'claude',
        task: 'review',
        briefId: null,
        startedAt: '2026-08-28T09:38:00Z',
        finishedAt: '2026-08-28T09:39:10Z',
        errorMessage: null,
      },
      review: diaryReview(),
      imageBriefs: diaryBriefs(),
      blockers: ['還有 5 項校稿建議沒處理', '還沒渲染，先按「渲染」產生校樣'],
    }),
    baseLongform('f-media', {
      state: 'MEDIA_READY',
      media: [media(41, '雨天的路口'), media(42, '回報流程圖', false)],
      featuredMediaId: null,
      imageBriefs: longformBriefs(),
      blockers: ['這個發布目標必須設定精選圖片', '還沒渲染，先按「渲染」產生校樣'],
    }),
    baseLongform('f-rendered', { state: 'RENDERED', blockers: ['還沒核准'] }),
    baseDiary('f-previewed', {
      state: 'PREVIEWED',
      marks: DIARY_MARKS,
      currentRevision: revision(2, 'agent_review', { title: '20260828', slug: '20260828', body: DIARY_BODY, category: '隨筆' }, '5c02f7ab91de4460'),
      agentRun: {
        status: 'succeeded',
        provider: 'codex',
        task: 'review',
        briefId: null,
        startedAt: '2026-08-28T09:38:00Z',
        finishedAt: '2026-08-28T09:39:02Z',
        errorMessage: null,
      },
      blockers: ['還沒核准'],
    }),
    baseLongform('f-approved', {
      state: 'APPROVED',
      approval: { id: 7, contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'), createdAt: '2026-08-28T10:20:00Z', valid: true },
      blockers: [],
    }),
    baseLongform('f-torn', {
      state: 'RENDERED',
      currentRevision: revision(
        4,
        'media',
        { title: '看得見的錯誤', slug: 'visible-mistakes', body: LONGFORM_BODY, tags: ['隨筆'] },
        'ee18c3407b9d2a61',
      ),
      approval: {
        id: 8,
        contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'),
        createdAt: '2026-08-28T10:20:00Z',
        valid: false,
      },
      blockers: ['內容改過了，核准已失效，請重新預覽並核准'],
    }),
    baseLongform('f-publishing', {
      state: 'PUBLISHING',
      approval: { id: 9, contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'), createdAt: '2026-08-28T10:20:00Z', valid: true },
      blockers: [],
    }),
    baseLongform('f-published', {
      state: 'PUBLISHED',
      approval: { id: 10, contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'), createdAt: '2026-08-28T10:20:00Z', valid: true },
      published: { wordpressId: 1783, status: 'draft', link: 'https://www.remusplus.com/?p=1783' },
      blockers: [],
    }),
    baseDiary('f-failed', {
      state: 'FAILED',
      blockers: ['遠端文章在本次載入之後被改過。請重新載入內容並重新核准，再發布一次。'],
    }),
    baseArticle('f-article', {}),
  ];
  return new Map(jobs.map((job) => [job.uuid, job]));
}

const store = buildStore();

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

// --- 作者（P5-T024）------------------------------------------------------------
//
// `?fixtures=1&authors=…` 切換情境：
// - 不給：站上有使用者本人與 AI 帳號，還沒設預設作者（第一次用的樣子）
// - `default`：已經設好預設作者＝本人（之後每一篇的樣子）
// - `only-self`：帳號是 Author，只能用自己
// - `stale`：預設作者不在這個站（換過站）
// - `unavailable`：讀不到站上的作者清單（安全外掛擋了），預設作者是本人 → 發布被擋

const FIXTURE_AUTHORS: AuthorOption[] = [
  { id: 2, name: 'Remus' },
  { id: 7, name: 'AI Romulus' },
  { id: 9, name: '小編阿青' },
];
const FIXTURE_ME: AuthorOption = { id: 7, name: 'AI Romulus' };

function authorScenario(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('authors');
}

let fixtureDefaultAuthorId: number | null = (() => {
  const scenario = authorScenario();
  if (scenario === 'default') return 2;
  if (scenario === 'stale') return 42;
  if (scenario === 'unavailable') return 2;
  return null;
})();

function fixtureAuthors(): AuthorsResponse {
  if (authorScenario() === 'unavailable') {
    return clone({
      authors: [FIXTURE_ME],
      currentUser: FIXTURE_ME,
      canChooseOthers: false,
      defaultAuthorId: fixtureDefaultAuthorId,
      defaultAuthor: null,
      notice:
        '讀不到站上的作者清單：站上不讓這個帳號列出使用者（HTTP 403），常見原因是安全外掛擋了 /wp/v2/users。' +
        '有設預設作者，所以現在發布會被擋下（免得作者被記成發布台的帳號），稍後再試。',
      listUnavailable: true,
    });
  }
  const onlySelf = authorScenario() === 'only-self';
  const authors = onlySelf ? [FIXTURE_ME] : FIXTURE_AUTHORS;
  const defaultAuthor = authors.find((author) => author.id === fixtureDefaultAuthorId) ?? null;
  const notice = onlySelf
    ? '這個帳號只能用自己當作者，要改作者請在 WordPress 把它升成 Editor'
    : fixtureDefaultAuthorId !== null && defaultAuthor === null
      ? `預設作者（第 ${fixtureDefaultAuthorId} 號使用者）不在這個站可以當作者的名單裡，可能是換過站。請重新選一個並設為預設。`
      : null;
  return clone({
    authors,
    currentUser: FIXTURE_ME,
    canChooseOthers: !onlySelf,
    defaultAuthorId: fixtureDefaultAuthorId,
    defaultAuthor,
    notice,
    listUnavailable: false,
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readBody(job: FixtureJob): string {
  const value = job.currentRevision?.templateData['body'];
  return typeof value === 'string' ? value : '';
}

function mustGet(uuid: string): FixtureJob {
  const job = store.get(uuid);
  if (!job) throw new Error(`示範資料裡沒有這篇稿件：${uuid}`);
  return job;
}

function nextHash(): string {
  return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
}

/** 內容一改就撕掉印章，並退回 RENDERED——跟 CoreService 該做的事一樣。 */
function invalidateApproval(job: FixtureJob, _reason: string): void {
  if (job.approval && job.approval.valid) {
    job.approval = { ...job.approval, valid: false };
    if (job.state === 'APPROVED') job.state = 'RENDERED';
    job.blockers = ['內容改過了，核准已失效，請重新預覽並核准'];
  }
}

/**
 * 正文的頂層區塊（HTML）。示範資料跑在瀏覽器裡，直接借 DOMParser 拆；規則跟後端的
 * splitTopLevelBlocks 一樣只看頂層元素（示範資料的正文沒有裸文字）。
 */
function bodyBlocks(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return Array.from(doc.body.firstElementChild?.children ?? []).map((element) => element.outerHTML);
}

function blockText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/** 圖片在不在正文、在第幾段之後，跟後端一樣從正文算，不另外記。 */
function syncPlacement(job: FixtureJob): void {
  const blocks = bodyBlocks(readBody(job));
  job.media = job.media.map((asset) => {
    const at =
      asset.wordpressMediaId === null ? -1 : blocks.findIndex((html) => hasWpImageClass(html, asset.wordpressMediaId!));
    return { ...asset, placed: at >= 0, placedAfterBlockIndex: at >= 0 ? at - 1 : null };
  });
}

/** 換一版正文：版本 +1、換 hash、撕核准。跟後端 createRevision 的效果一樣。 */
function replaceBody(job: FixtureJob, body: string, reason: string): void {
  if (!job.currentRevision) return;
  invalidateApproval(job, reason);
  job.currentRevision = {
    ...job.currentRevision,
    number: job.currentRevision.number + 1,
    origin: 'media',
    contentHash: nextHash().padEnd(64, '0'),
    templateData: { ...job.currentRevision.templateData, body },
    publishHtml: body,
  };
  job.revisionCount += 1;
  syncPlacement(job);
}

/** 正文裡的圖片區塊，跟後端 buildFigureHtml 同樣的形狀。 */
function figureHtml(asset: MediaAsset): string {
  const caption = asset.caption ? `<figcaption class="wp-element-caption">${asset.caption}</figcaption>` : '';
  return (
    `<figure class="wp-block-image size-large aligncenter"><img src="${asset.url ?? ''}" alt="${asset.altText ?? ''}" ` +
    `class="wp-image-${asset.wordpressMediaId}" />${caption}</figure>`
  );
}

/** 照錨點自動放（跟後端 autoPlace 同一套規則：忽略空白、剛好一段才放）。 */
/** 校稿或一鍵配圖正在跑（生圖不算）：這時建新版本會讓那一趟的結果作廢，跟後端 contentRunActive 一樣。 */
function contentRunActive(job: FixtureJob): boolean {
  return job.agentRun?.status === 'running' && job.agentRun.task !== 'generate-image';
}

async function fixtureAutoPlace(job: FixtureJob, asset: MediaAsset, brief: ImageBrief): Promise<AutoPlaceResult> {
  if (contentRunActive(job)) {
    return {
      outcome: 'agent-running',
      message:
        'AI 還在跑，等它跑完再放（圖已經上傳了）：跑完之後在文章段落之間按「在這裡插圖」，或用圖片的「插入位置」選。',
      afterBlockIndex: null,
    };
  }
  // 「換一張」：同一條需求較新的舊圖還在正文裡，新圖接替它的位置。
  const blocks = bodyBlocks(readBody(job));
  const previous = [...job.media]
    .reverse()
    .find(
      (row) =>
        row.id !== asset.id &&
        row.briefKey === brief.key &&
        row.wordpressMediaId !== null &&
        blocks.some((html) => hasWpImageClass(html, row.wordpressMediaId!)),
    );
  if (previous) {
    const figure = figureHtml(asset);
    const next = blocks.map((html) => (hasWpImageClass(html, previous.wordpressMediaId!) ? figure : html));
    replaceBody(job, next.join('\n'), '換一張配圖');
    const at = next.findIndex((html) => html === figure) - 1;
    return {
      outcome: 'replaced',
      message: `已換掉正文裡原本那張（${at < 0 ? '文章最前面' : `第 ${at + 1} 段之後`}）。舊圖拿出正文了，還留在媒體庫。`,
      afterBlockIndex: at,
    };
  }
  const mine = brief.origin === 'user';
  const side = brief.anchorPosition === 'before' ? '後面' : '前面';
  const why = (text: string): string =>
    `找不到${mine ? '你選的' : '建議的'}位置，請自己放：${text}在文章段落之間按「在這裡插圖」，或用圖片的「插入位置」選。`;
  const anchor = brief.anchor?.trim() ?? '';
  if (anchor === '') {
    return {
      outcome: 'not-found',
      message: why(mine ? '你選的位置前後都沒有文字可以對照。' : 'AI 沒有指定要放在哪一段。'),
      afterBlockIndex: null,
    };
  }
  const quoted = mine ? `你選的位置${side}那段「${anchor}」` : `AI 引用的「${anchor}」`;
  const hits = bodyBlocks(readBody(job)).flatMap((html, index) =>
    findIgnoringSpaces(blockText(html), anchor) === null ? [] : [index],
  );
  if (hits.length === 0) {
    return { outcome: 'not-found', message: why(`${quoted}在目前的文章裡找不到（可能改過了）。`), afterBlockIndex: null };
  }
  if (hits.length > 1) {
    return {
      outcome: 'ambiguous',
      message: why(`${quoted}在文章裡出現在 ${hits.length} 段，不確定是哪一段。`),
      afterBlockIndex: null,
    };
  }
  const at = brief.anchorPosition === 'before' ? hits[0]! - 1 : hits[0]!;
  await fixtureApi.placeMedia(job.uuid, asset.id, at);
  return {
    outcome: 'placed',
    message: at < 0 ? '已放進正文最前面。' : `已放進正文第 ${at + 1} 段之後。`,
    afterBlockIndex: at,
  };
}

/**
 * 「請 AI 配一張」的錨點（跟後端 positionAnchor 同一套規則的簡化版）：前面那段有字就引用它、放在它之後；
 * 沒有（文章最前面、前一塊是圖）就引用後面那段、放在它之前。取開頭 20 字起、整篇唯一為止。
 */
function fixtureAnchor(texts: string[], afterBlockIndex: number): { anchor: string | null; position: 'after' | 'before' } {
  // 那一段開頭、整篇只對得上這一段的最短引用；沒字或整段都不唯一（例如被別段包住的「晚安。」）就是 null。
  const pick = (index: number): string | null => {
    const text = (texts[index] ?? '').trim();
    if (text === '') return null;
    const chars = Array.from(text);
    const lengths: number[] = [];
    for (let length = 20; length < chars.length; length += 10) lengths.push(length);
    lengths.push(chars.length);
    for (const length of lengths) {
      const candidate = chars.slice(0, length).join('').trim();
      if (texts.filter((other) => findIgnoringSpaces(other, candidate) !== null).length === 1) return candidate;
    }
    return null;
  };
  const before = afterBlockIndex >= 0 ? pick(afterBlockIndex) : null;
  if (before !== null) return { anchor: before, position: 'after' };
  const after = pick(afterBlockIndex + 1);
  if (after !== null) return { anchor: after, position: 'before' };
  return { anchor: null, position: 'after' };
}

/** 示範資料模式加 `&codex=off`：模擬 Codex 沒登入，練「請 AI 配一張」停用的樣子。 */
function fixtureCodexOff(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('codex') === 'off';
}

/** 假的生圖：等幾秒（練計時器），沒被停止就給一張灰色的候選圖。跟後端一樣不上傳、不動內容。 */
async function fixtureGenerate(job: FixtureJob, briefId: number): Promise<ImageCandidate> {
  job.agentRun = {
    status: 'running',
    provider: 'codex',
    task: 'generate-image',
    briefId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    errorMessage: null,
  };
  await delay(3200);
  if (job.agentRun.status === 'cancelled') throw new Error('執行已取消');
  const candidate: ImageCandidate = {
    id: Math.floor(Math.random() * 90_000) + 10_000,
    briefId,
    url: GREY_PNG,
    mimeType: 'image/png',
    byteSize: 1_742_336,
    width: 1672,
    height: 941,
    createdAt: new Date().toISOString(),
  };
  job.agentRun = { ...job.agentRun, status: 'succeeded', finishedAt: new Date().toISOString() };
  job.imageBriefs = job.imageBriefs.map((row) => (row.id === briefId ? { ...row, candidate } : row));
  return clone(candidate);
}

const delay = (ms = 220): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const fixtureApi: PublisherApi = {
  async listJobs(filter) {
    await delay(120);
    const all = [...store.values()];
    const filtered = filter?.state?.length ? all.filter((j) => filter.state?.includes(j.state)) : all;
    return filtered.map<JobSummary>((job) => ({
      uuid: job.uuid,
      state: job.state,
      title: job.title,
      targetKey: job.target.key,
      templateId: job.template?.id ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      revisionCount: job.revisionCount,
      revisionNumber: job.currentRevision?.number ?? null,
      approved: job.approval?.valid === true,
      publishedId: job.published?.wordpressId ?? null,
      pendingReviewCount: job.review?.pendingCount ?? 0,
    }));
  },

  async createJob(input: CreateJobInput): Promise<{ uuid: string }> {
    await delay();
    const uuid = `f-new-${store.size + 1}`;
    const target =
      [DIARY_TARGET, LONGFORM_TARGET, POST_TARGET, PAGE_TARGET].find((item) => item.key === input.targetKey) ??
      LONGFORM_TARGET;
    const base =
      target.contentType === 'diary' ? baseDiary : target.contentType === 'article' ? baseArticle : baseLongform;
    const job = base(uuid, {
      state: 'SOURCE',
      title: input.title ?? null,
      target,
      marks: [],
      media: [],
      featuredMediaId: null,
      approval: null,
      published: null,
      agentRun: null,
      blockers: ['還沒渲染，先按「渲染」產生校樣'],
      sourceText: input.sourceText,
      currentRevision: revision(
        1,
        'source',
        { title: input.title ?? '未命名', body: `<p>${input.sourceText.slice(0, 400)}</p>` },
        nextHash(),
      ),
    });
    store.set(uuid, job);
    return { uuid };
  },

  async getJob(uuid: string) {
    await delay(90);
    const job = mustGet(uuid);
    syncPlacement(job);
    return clone(job);
  },

  async cancelJob(uuid: string) {
    await delay();
    mustGet(uuid).state = 'CANCELLED';
  },

  async createRevision(uuid: string, input: CreateRevisionInput) {
    await delay();
    const job = mustGet(uuid);
    invalidateApproval(job, '內容有新的修改');
    const current = job.currentRevision;
    const next = revision(
      (current?.number ?? 0) + 1,
      input.origin ?? 'manual',
      {
        ...(current?.templateData ?? {}),
        ...(input.templateData ?? {}),
        // 示範資料不做後端的整理（normalizeEditedBody），原樣收下。
        ...(input.editedBody === undefined ? {} : { body: input.editedBody }),
      },
      nextHash(),
    );
    job.currentRevision = next;
    if (input.sourceText !== undefined) job.sourceText = input.sourceText;
    // 從卡片進去改的：那一項跟著結案（後端 createRevision 的 resolveItemId）。
    if (input.resolveItemId !== undefined && job.review) {
      job.review = {
        ...job.review,
        items: job.review.items.map((item) =>
          item.id === input.resolveItemId && item.state !== 'applied'
            ? { ...item, state: 'skipped' as const, resolvedAt: new Date().toISOString(), resolvedByEdit: true }
            : item,
        ),
      };
    }
    return clone(next);
  },

  async listRevisions(uuid: string) {
    await delay(80);
    const job = mustGet(uuid);
    return job.currentRevision ? [clone(job.currentRevision)] : [];
  },

  async render(uuid: string): Promise<RenderOutcome> {
    await delay(420);
    const job = mustGet(uuid);
    job.state = 'RENDERED';
    job.blockers = ['還沒核准'];
    const current = job.currentRevision;
    return {
      revisionId: current?.id ?? 0,
      revisionNumber: current?.number ?? 1,
      contentHash: current?.contentHash ?? nextHash(),
      publishHtml: current?.publishHtml ?? '',
      previewDocument: previewDocument(job),
      sanitize: { changed: false, removedTags: [], removedAttributes: [] },
      state: job.state,
    };
  },

  // 跟真的後端一樣：載入校樣＝使用者看過了，RENDERED 推進 PREVIEWED（核准只能從那裡出發）。
  async fetchPreview(uuid: string) {
    await delay(160);
    const job = mustGet(uuid);
    if (job.state === 'RENDERED') {
      job.state = 'PREVIEWED';
      job.blockers = job.blockers.filter((blocker) => blocker !== '還沒渲染，先按「渲染」產生校樣');
    }
    return previewDocument(job);
  },

  // 示範資料沒有真的 HTTP 回應，校樣一定是照目前這一版畫的，所以直接回它的 hash。
  async fetchPreviewHash(uuid: string) {
    await delay(60);
    return mustGet(uuid).currentRevision?.contentHash ?? null;
  },

  /**
   * 校稿。**內容一個字都不動**——結果存成待處理清單，等使用者逐項決定。
   * 核准因此也不會失效，這正是提案制跟「直接落地」的差別。
   */
  async runAgent(uuid: string, input: AgentReviewInput): Promise<AgentRunResult> {
    const job = mustGet(uuid);
    const task = input.task ?? 'review';
    const startedAt = new Date().toISOString();
    job.agentRun = {
      status: 'running',
      provider: input.provider,
      task,
      briefId: null,
      startedAt,
      finishedAt: null,
      errorMessage: null,
    };
    // 真的 Agent 要跑幾十秒到幾分鐘。示範資料等久一點，才練得到「執行中」的畫面。
    await delay(task === 'images' ? 2600 : 3400);
    job.agentRun = {
      status: 'succeeded',
      provider: input.provider,
      task,
      briefId: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: null,
    };

    // 配圖那一趟不建提案，所以按「一鍵配圖」不會洗掉還沒清完的校稿清單。
    if (task === 'images') {
      job.imageBriefs = diaryBriefs();
      return {
        runId: 'fixture-run',
        status: 'succeeded',
        summary: '兩個配圖建議',
        changes: [],
        observations: [],
        // 後端回的是 Agent 交回來的原樣（還沒有 id），不是存進去之後的樣子。
        imageBriefs: job.imageBriefs.map((brief) => ({
          key: brief.key,
          purpose: brief.purpose,
          prompt: brief.prompt,
          aspectRatio: brief.aspectRatio,
          altText: brief.altText,
          ...(brief.caption === null ? {} : { caption: brief.caption }),
          ...(brief.placement === null ? {} : { placement: brief.placement }),
          ...(brief.anchor === null ? {} : { anchor: brief.anchor }),
        })),
        task,
        review: clone(job.review),
      };
    }

    if (job.state === 'SOURCE') job.state = 'REVIEWED';
    job.review = { ...diaryReview(), provider: input.provider };
    job.blockers = [`還有 ${job.review.pendingCount} 項校稿建議沒處理`];
    return {
      runId: 'fixture-run',
      status: 'succeeded',
      summary: job.review.summary,
      changes: job.review.items.flatMap((item) => (item.change ? [item.change] : [])),
      observations: job.review.items.flatMap((item) => (item.observation ? [item.observation] : [])),
      imageBriefs: [],
      task,
      review: clone(job.review),
    };
  },

  async dismissImageBrief(uuid: string, briefId: number) {
    await delay(120);
    const job = mustGet(uuid);
    job.imageBriefs = job.imageBriefs.filter((brief) => brief.id !== briefId);
  },

  async cancelAgent(uuid: string) {
    await delay(100);
    const job = mustGet(uuid);
    if (job.agentRun) job.agentRun = { ...job.agentRun, status: 'cancelled' };
  },

  async getImageGenerationStatus(): Promise<ImageGenerationStatus> {
    await delay(120);
    if (fixtureCodexOff()) {
      return {
        available: false,
        provider: 'codex',
        reason: '只有 Codex 能生圖，但它現在不能用：尚未登入，請在終端機執行 `codex login`',
      };
    }
    return { available: true, provider: 'codex', reason: null };
  },

  /**
   * 假的生圖：等幾秒（練「執行中」的計時器），然後給一張灰色的候選圖。
   * 跟後端一樣：**不上傳、不動內容、不撕核准**；等待中按停止就不收。
   */
  async generateBriefImage(uuid: string, briefId: number): Promise<ImageCandidate> {
    const job = mustGet(uuid);
    if (job.agentRun?.status === 'running') throw new Error('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    const brief = job.imageBriefs.find((row) => row.id === briefId);
    if (!brief) throw new Error(`找不到這個工作項目的配圖需求 ${briefId}`);
    return fixtureGenerate(job, briefId);
  },

  /**
   * 「請 AI 配一張」（P5-T018）：建一條使用者發起的配圖需求，馬上回來，生圖在背後跑（跟後端一樣不等）。
   */
  async requestImageAtPosition(uuid, input): Promise<ImageBrief> {
    await delay(200);
    const job = mustGet(uuid);
    if (fixtureCodexOff()) throw new Error('只有 Codex 能生圖，但它現在不能用：尚未登入，請在終端機執行 `codex login`');
    if (job.agentRun?.status === 'running') throw new Error('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    if (input.contentHash !== job.currentRevision?.contentHash) {
      throw new Error('文章在你按下去之前換了一版，位置可能已經不對了。重新讀取之後再選一次位置。');
    }
    const texts = bodyBlocks(readBody(job)).map((html) => blockText(html).replace(/\s+/g, ' ').trim());
    if (input.afterBlockIndex < -1 || input.afterBlockIndex > texts.length - 1) {
      throw new Error(`插入位置 ${input.afterBlockIndex} 超出範圍`);
    }
    const note = normalizeUserNote(input.note);
    if (userNoteLength(note) > USER_NOTE_MAX) throw new Error(`想要什麼樣的圖，最多 ${USER_NOTE_MAX} 個字`);
    const { anchor, position } = fixtureAnchor(texts, input.afterBlockIndex);
    const brief: ImageBrief = {
      id: Math.floor(Math.random() * 90_000) + 10_000,
      key: `user-${Math.random().toString(16).slice(2, 10)}`,
      purpose: '你在文章上指定位置、請 AI 配的圖',
      prompt: '（示範資料：後端會用前後段落與你的那句話組成生圖指令）',
      aspectRatio: '16:9',
      altText: '',
      caption: null,
      placement: null,
      anchor,
      fulfilled: false,
      dismissed: false,
      createdAt: new Date().toISOString(),
      isFeatured: false,
      candidate: null,
      origin: 'user',
      anchorPosition: position,
      note,
    };
    job.imageBriefs = [...job.imageBriefs, brief];
    void fixtureGenerate(job, brief.id).catch(() => undefined);
    return clone(brief);
  },

  async useImageCandidate(uuid: string, candidateId: number, altText?: string): Promise<MediaUploadResult> {
    const job = mustGet(uuid);
    const brief = job.imageBriefs.find((row) => row.candidate?.id === candidateId);
    if (!brief || !brief.candidate) throw new Error(`找不到這個工作項目的候選圖 ${candidateId}`);
    const result = await fixtureApi.addMedia(uuid, {
      file: new Blob([new Uint8Array(brief.candidate.byteSize)], { type: brief.candidate.mimeType }),
      filename: brief.origin === 'user' ? `illustration-${brief.key.slice(5, 11)}` : brief.key,
      mimeType: brief.candidate.mimeType,
      altText: altText?.trim() || brief.altText,
      briefKey: brief.key,
      ...(brief.caption === null ? {} : { caption: brief.caption }),
    });
    job.imageBriefs = job.imageBriefs.map((row) => (row.id === brief.id ? { ...row, candidate: null } : row));
    return result;
  },

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

    job.review.pendingCount = job.review.items.filter(
      (item) => item.state === 'pending' || item.state === 'unappliable',
    ).length;
    if (job.review.pendingCount === 0) job.review = null;
    job.blockers = job.review ? [`還有 ${job.review.pendingCount} 項校稿建議沒處理`] : [];

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
    // 明寫 fixtureApi 不用 this：呼叫端是透過 client.ts 的 Proxy 取到這個函式的，
    // this 綁到誰要看呼叫方式，不該去賭。
    return fixtureApi.resolveReview(uuid, { itemIds: changeIds, decision: 'apply' });
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

  async addMedia(uuid: string, input: AddMediaInput): Promise<MediaUploadResult> {
    await delay(500);
    const job = mustGet(uuid);
    // 上傳本身不改正文，核准不失效（跟後端一樣）；自動放進正文或設精選時才失效。
    const asset: MediaAsset = {
      // 跟後端一樣：上傳成功就有 WordPress 的媒體編號與網址，才放得進正文（P5-T016）。
      ...media(Math.floor(Math.random() * 900) + 100, input.altText ?? '', true),
      byteSize: input.file.size,
      mimeType: input.mimeType,
      briefKey: input.briefKey ?? null,
      ...(input.caption === undefined ? {} : { caption: input.caption }),
    };
    job.media = [...job.media, asset];

    // 對上配圖需求就算完成；封面那條在沒有別的封面時自動設成精選（跟後端的 autoFeature 一樣，
    // 不覆蓋使用者選的封面）。
    const brief = input.briefKey === undefined ? undefined : job.imageBriefs.find((row) => row.key === input.briefKey);
    if (!brief) return { media: clone(asset), autoFeature: null, autoPlace: null };
    job.imageBriefs = job.imageBriefs.map((row) => (row.id === brief.id ? { ...row, fulfilled: true } : row));
    if (!brief.isFeatured) {
      const autoPlace = await fixtureAutoPlace(job, asset, brief);
      const placed = job.media.find((row) => row.id === asset.id) ?? asset;
      return { media: clone(placed), autoFeature: null, autoPlace };
    }

    if (contentRunActive(job)) {
      return {
        media: clone(asset),
        autoFeature: {
          outcome: 'agent-running',
          message: 'AI 還在跑，等它跑完再設成精選（圖已經上傳了）：跑完之後按圖片上的「設為精選」。',
        },
        autoPlace: null,
      };
    }
    const current = job.media.find((row) => row.id === job.featuredMediaId);
    if (current && current.briefKey !== brief.key) {
      return {
        media: clone(asset),
        autoFeature: {
          outcome: 'kept-existing',
          message: '已經有封面了，沒有換掉。要換成這張，按圖片上的「設為精選」。',
        },
        autoPlace: null,
      };
    }
    await fixtureApi.setFeaturedMedia(uuid, asset.id);
    return {
      media: clone({ ...asset, featured: true }),
      autoFeature: { outcome: 'set', message: '已設成精選圖片。' },
      autoPlace: null,
    };
  },

  async replaceMedia(uuid: string, assetId: number, input: AddMediaInput) {
    await delay(500);
    const job = mustGet(uuid);
    invalidateApproval(job, '換掉了一張圖片');
    const replaced: MediaAsset = {
      ...media(assetId, input.altText ?? '', false),
      byteSize: input.file.size,
      mimeType: input.mimeType,
    };
    job.media = job.media.map((asset) => (asset.id === assetId ? replaced : asset));
    return replaced;
  },

  async removeMedia(uuid: string, assetId: number) {
    await delay();
    const job = mustGet(uuid);
    invalidateApproval(job, '移除了一張圖片');
    const removed = job.media.find((asset) => asset.id === assetId);
    if (removed?.wordpressMediaId != null) {
      const wpId = removed.wordpressMediaId;
      const blocks = bodyBlocks(readBody(job));
      if (blocks.some((html) => hasWpImageClass(html, wpId))) {
        replaceBody(job, blocks.filter((html) => !hasWpImageClass(html, wpId)).join('\n'), '移除了一張圖片');
      }
    }
    job.media = job.media.filter((asset) => asset.id !== assetId);
    if (job.featuredMediaId === assetId) job.featuredMediaId = null;
  },

  /** 真的把圖插進正文（校樣上看得到），跟後端一樣：已經在正文裡就是搬家。 */
  async placeMedia(uuid: string, assetId: number, afterBlockIndex: number) {
    await delay();
    const job = mustGet(uuid);
    const asset = job.media.find((row) => row.id === assetId);
    if (!asset || asset.wordpressMediaId === null || asset.url === null) {
      throw new Error('這張圖還沒上傳到 WordPress，無法插進正文');
    }
    const wpId = asset.wordpressMediaId;
    const blocks = bodyBlocks(readBody(job));
    if (afterBlockIndex < -1 || afterBlockIndex > blocks.length - 1) {
      throw new Error(`插入位置 ${afterBlockIndex} 超出範圍`);
    }
    const removedBefore = blocks.filter((html, index) => hasWpImageClass(html, wpId) && index <= afterBlockIndex).length;
    const kept = blocks.filter((html) => !hasWpImageClass(html, wpId));
    const target = afterBlockIndex - removedBefore;
    const figure = figureHtml(asset);
    kept.splice(target + 1, 0, figure);
    replaceBody(job, kept.join('\n'), '移動了圖片的位置');
  },

  async setFeaturedMedia(uuid: string, assetId: number | null) {
    await delay();
    const job = mustGet(uuid);
    invalidateApproval(job, '換了精選圖片');
    job.featuredMediaId = assetId;
    job.media = job.media.map((asset) => ({ ...asset, featured: asset.id === assetId }));
    job.blockers = job.blockers.filter((b) => !b.includes('精選圖片'));
  },

  async approve(uuid: string, contentHash: string): Promise<Approval> {
    await delay(320);
    const job = mustGet(uuid);
    const approval: Approval = {
      id: Math.floor(Math.random() * 900) + 100,
      contentHash,
      createdAt: new Date().toISOString(),
      valid: true,
    };
    job.approval = approval;
    job.state = 'APPROVED';
    job.blockers = [];
    return approval;
  },

  async revokeApproval(uuid: string, _reason: string) {
    await delay();
    const job = mustGet(uuid);
    if (job.approval) job.approval = { ...job.approval, valid: false };
    job.state = 'RENDERED';
    job.blockers = ['還沒核准'];
  },

  async publish(uuid: string, input: PublishInput): Promise<PublishResult> {
    const job = mustGet(uuid);
    const listed = fixtureAuthors();
    if (listed.listUnavailable && (input.authorId !== undefined || listed.defaultAuthorId !== null)) {
      throw new Error('讀不到站上的作者清單，這次沒有發布，免得作者被記成發布台的帳號；稍後再試。');
    }
    const wantedAuthor = input.authorId ?? listed.defaultAuthor?.id ?? null;
    const author = listed.authors.find((option) => option.id === wantedAuthor) ?? null;
    if (input.authorId !== undefined && author === null) {
      throw new Error(`指定的作者（第 ${input.authorId} 號使用者）不在這個站可以當作者的名單裡。這次沒有送出任何內容。`);
    }
    job.state = 'PUBLISHING';
    await delay(1500);
    const result: PublishResult = {
      wordpressId: 1800 + Math.floor(Math.random() * 90),
      status: input.status,
      link: `https://www.remusplus.com/${job.target.key}/${job.title ?? 'untitled'}/`,
      created: true,
      unknownTerms: [],
      fallbackBlocks: 0,
      author,
    };
    job.published = result;
    job.state = 'PUBLISHED';
    return result;
  },

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

  async listAuthors() {
    await delay(120);
    return fixtureAuthors();
  },

  async setDefaultAuthor(authorId: number | null) {
    await delay(200);
    if (authorId !== null && !fixtureAuthors().authors.some((author) => author.id === authorId)) {
      throw new Error(`第 ${authorId} 號使用者不在這個站可以當作者的名單裡`);
    }
    fixtureDefaultAuthorId = authorId;
    return fixtureAuthors();
  },

  async listTargets() {
    await delay(80);
    return [LONGFORM_TARGET, DIARY_TARGET, POST_TARGET, PAGE_TARGET];
  },

  async getSetupStatus() {
    await delay(80);
    return clone(setupState());
  },

  async testWordPressConnection(input) {
    await delay(900);
    return fixtureConnectionResult(fixtureSetupScenario, input.url);
  },

  async saveWordPressConnection(testId, confirmSiteChange) {
    await delay(300);
    if (testId !== FIXTURE_TEST_ID) throw new Error('這次的測試結果已經失效，請再按一次「測試連線」。');
    if (fixtureSetupScenario === 'ok-site-change' && confirmSiteChange !== true) {
      throw new Error('要換站：舊站上的稿件與圖不會跟過去。確認之後再存。');
    }
    const state = setupState();
    state.wordpress = { url: lastTestedUrl, username: 'ming' };
    state.needsSetup = !state.siteConfig.exists;
    return { saved: true as const, restartRequired: false, backupFile: null, status: clone(state) };
  },

  async getSetupAgents() {
    await delay(700);
    return clone(FIXTURE_SETUP_AGENTS);
  },

  async getSetupDestinations() {
    await delay(400);
    const existing = setupState().siteConfig.targets;
    return {
      existing: clone(existing),
      options: [
        {
          key: 'post' as const,
          displayName: '文章',
          postType: 'post',
          available: true,
          reason: null,
          restBase: 'posts',
          taxonomy: 'category',
          taxonomyRestBase: 'categories',
          existing: existing.find((target) => target.key === 'post') ?? null,
        },
        {
          key: 'page' as const,
          displayName: '頁面',
          postType: 'page',
          available: true,
          reason: null,
          restBase: 'pages',
          taxonomy: null,
          taxonomyRestBase: null,
          existing: existing.find((target) => target.key === 'page') ?? null,
        },
      ],
    };
  },

  async saveSetupDestinations(input) {
    await delay(400);
    const state = setupState();
    const had = state.siteConfig.exists;
    for (const key of input.include) {
      const target = key === 'post' ? POST_TARGET : PAGE_TARGET;
      const index = state.siteConfig.targets.findIndex((item) => item.key === key);
      if (index === -1) state.siteConfig.targets.push(target);
      else if (input.replace.includes(key)) state.siteConfig.targets[index] = target;
      else throw new Error(`設定檔裡已經有「${target.displayName}」（key: ${key}）。要換成精靈產生的設定，請勾選「取代」。`);
    }
    state.siteConfig.exists = true;
    state.needsSetup = state.wordpress === null;
    return {
      saved: true as const,
      restartRequired: false,
      backupFile: had ? 'backups/publish-targets-20260924-101500.json' : null,
      status: clone(state),
    };
  },
};

// --- 設定精靈的示範資料（P8-T002）------------------------------------------------
//
// `?fixtures=1&setup=needed` 模擬「什麼都還沒設定」（會自動進精靈）；不加就是「已經設定好、從設定頁重跑」，
// 設定檔裡已經有四個目標，所以第三步看得到「已經有、要不要取代」。
// 測試連線的結果由精靈畫面上（只在示範模式出現）的下拉選單決定，每一種失敗都看得到。

interface FixtureSetupState {
  needsSetup: boolean;
  wordpress: { url: string; username: string } | null;
  siteConfig: { exists: boolean; targets: PublishTargetSummary[] };
  canWrite: boolean;
}

let fixtureSetup: FixtureSetupState | null = null;

function setupState(): FixtureSetupState {
  if (fixtureSetup) return fixtureSetup;
  const fresh = new URLSearchParams(window.location.search).get('setup') === 'needed';
  fixtureSetup = fresh
    ? { needsSetup: true, wordpress: null, siteConfig: { exists: false, targets: [] }, canWrite: true }
    : {
        needsSetup: false,
        wordpress: { url: 'https://example.com', username: 'ming' },
        siteConfig: { exists: true, targets: [LONGFORM_TARGET, DIARY_TARGET, POST_TARGET, PAGE_TARGET] },
        canWrite: true,
      };
  return fixtureSetup;
}

const FIXTURE_TEST_ID = 'fixture-test-id';
let lastTestedUrl = 'https://example.com';

export type FixtureSetupScenario = 'ok' | 'ok-site-change' | SetupProblemKind;

export const FIXTURE_SETUP_SCENARIOS: { key: FixtureSetupScenario; label: string }[] = [
  { key: 'ok', label: '全部通過' },
  { key: 'ok-site-change', label: '通過，但換了站（舊站有發過文）' },
  { key: 'not-https', label: '不是 https' },
  { key: 'unreachable', label: '連不上（DNS）' },
  { key: 'redirect', label: '會被轉址' },
  { key: 'not-wordpress', label: '找不到 REST API' },
  { key: 'rest-blocked', label: 'REST 被安全外掛擋' },
  { key: 'app-passwords-disabled', label: '應用程式密碼被停用' },
  { key: 'auth-header-stripped', label: 'Authorization 被主機拿掉' },
  { key: 'wrong-username', label: '帳號不存在' },
  { key: 'wrong-password', label: '密碼不對' },
  { key: 'password-format', label: '密碼格式不對' },
  { key: 'no-permission', label: '權限不夠發文' },
  { key: 'types-missing', label: '文章頁面都沒開 REST' },
];

let fixtureSetupScenario: FixtureSetupScenario = 'ok';

export function setFixtureSetupScenario(key: FixtureSetupScenario): void {
  fixtureSetupScenario = key;
}

const FIXTURE_PROBLEMS: Partial<Record<SetupProblemKind, { stage: SetupCheck['key']; problem: SetupProblem }>> = {
  'not-https': {
    stage: 'https',
    problem: {
      kind: 'not-https',
      title: '網址不是 https',
      detail: '應用程式密碼會跟著每一個請求送出去；走 http 等於把密碼用明碼傳過網路。WordPress 預設也不讓 http 站使用應用程式密碼。',
      next: '把網址改成 https:// 開頭再測一次。站台還沒有 SSL 憑證的話，先到主機商後台開啟（多半有免費的 Let’s Encrypt）。',
    },
  },
  unreachable: {
    stage: 'reachable',
    problem: {
      kind: 'unreachable',
      title: '找不到這個網站',
      detail: '查不到「exmaple.com」的位址（DNS 找不到）。可能是網址打錯，或網域剛設定還沒生效。',
      next: '在瀏覽器打開這個網址確認拼字；網域剛買或剛改 DNS 的話，等幾個小時再試。',
    },
  },
  redirect: {
    stage: 'reachable',
    problem: {
      kind: 'redirect',
      title: '網址會被轉到別的地方',
      detail: '「https://example.com」會被轉到「https://www.example.com」。轉址時帳號密碼可能被丟掉，會出現「密碼明明對卻說沒權限」。',
      next: '把網址改成「https://www.example.com」再測一次。',
    },
  },
  'not-wordpress': {
    stage: 'rest',
    problem: {
      kind: 'not-wordpress',
      title: '這個網址找不到 WordPress 的 REST API',
      detail: 'https://example.com/wp-json/ 回 404。可能這不是 WordPress 站的首頁網址，或站台的「永久連結」設成了「預設」（那種設定下 /wp-json/ 不存在）。',
      next: '確認填的是 WordPress 站的首頁網址（WordPress 裝在子目錄的話要包含子目錄）。是的話，到後台「設定 → 永久連結」選「文章名稱」並儲存，再測一次。',
    },
  },
  'rest-blocked': {
    stage: 'rest',
    problem: {
      kind: 'rest-blocked',
      title: 'REST API 被安全外掛擋住了',
      detail: '帶著帳號密碼問「我是誰」（/wp/v2/users/me）被拒絕（HTTP 403，rest_forbidden）。安全外掛（Wordfence、Solid Security、All In One WP Security、Disable REST API 等）常會關掉 REST API，或專門擋使用者端點防止帳號被列舉。',
      next: '到那個外掛的設定裡允許 REST API（至少對登入的使用者），或把 /wp/v2/users 從封鎖清單拿掉，再測一次。',
    },
  },
  'app-passwords-disabled': {
    stage: 'auth',
    problem: {
      kind: 'app-passwords-disabled',
      title: '這個站停用了應用程式密碼',
      detail: 'WordPress 5.6 以後內建「應用程式密碼」，但這個站把它關掉了（常見於安全外掛的設定，或 WordPress 版本太舊）。沒有它，發布台就沒辦法用你的帳號發文。',
      next: '到安全外掛的設定打開「應用程式密碼」（Application Passwords），或請站台管理員打開；打開後到「使用者 → 個人資料」產生一組，再測一次。',
    },
  },
  'auth-header-stripped': {
    stage: 'auth',
    problem: {
      kind: 'auth-header-stripped',
      title: 'WordPress 沒收到帳號密碼',
      detail: '請求有帶帳號密碼，WordPress 卻說沒有登入。最常見的原因是主機把 Authorization 標頭擋掉了（Apache 搭配 CGI／FastCGI 時很常見）。',
      next: '請主機商讓 Authorization 標頭傳給 PHP；自己改的話，在網站根目錄的 .htaccess 加一行 SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1，再測一次。',
    },
  },
  'wrong-username': {
    stage: 'auth',
    problem: {
      kind: 'wrong-username',
      title: '找不到這個帳號',
      detail: 'WordPress 說沒有「ming」這個使用者。',
      next: '填後台登入用的帳號（使用者名稱）或它的 email，再測一次。',
    },
  },
  'wrong-password': {
    stage: 'auth',
    problem: {
      kind: 'wrong-password',
      title: '應用程式密碼不對',
      detail: '帳號對，但這組應用程式密碼不對，或已經被撤銷。注意：重設 WordPress 登入密碼會讓所有應用程式密碼一起失效。',
      next: '到後台「使用者 → 個人資料 → 應用程式密碼」產生一組新的，整串複製貼上再測一次。',
    },
  },
  'password-format': {
    stage: 'auth',
    problem: {
      kind: 'password-format',
      title: '應用程式密碼的格式不對',
      detail: '應用程式密碼是 24 個英文字母和數字（WordPress 顯示成 6 組、每組 4 個，空格有沒有都可以）；你貼上的是 12 個字元。最常見的原因是貼成了登入密碼。',
      next: '到後台「使用者 → 個人資料 → 應用程式密碼」產生一組新的，整串複製貼上。',
    },
  },
  'no-permission': {
    stage: 'permission',
    problem: {
      kind: 'no-permission',
      title: '這個帳號不能發布',
      detail: '「編輯小明」的角色是 contributor，WordPress 不讓它發布文章或頁面（缺 publish_posts／publish_pages）。投稿者（Contributor）只能送審，不能發布。',
      next: '用管理員登入後台，到「使用者」把這個帳號的角色改成「編輯」（Editor），再測一次。',
    },
  },
  'types-missing': {
    stage: 'types',
    problem: {
      kind: 'types-missing',
      title: '站上的文章和頁面都沒有開放 REST',
      detail: '/wp/v2/types 裡找不到 post，也找不到 page。發布台沒有地方可以發。',
      next: '通常是外掛把它們從 REST 拿掉了；檢查安全外掛或「Disable REST API」類外掛的設定，再測一次。',
    },
  },
};

const CHECK_KEYS: SetupCheck['key'][] = ['https', 'reachable', 'rest', 'auth', 'permission', 'types'];
const CHECK_LABELS: Record<SetupCheck['key'], string> = {
  https: '網址是 https',
  reachable: '連得上網站',
  rest: 'REST API 開著',
  auth: '帳號與應用程式密碼正確',
  permission: '帳號可以發布',
  types: '文章／頁面有開放 REST',
};

function fixtureConnectionResult(scenario: FixtureSetupScenario, url: string): SetupConnectionResult {
  lastTestedUrl = url.trim() === '' ? 'https://example.com' : url.trim();
  const found = scenario === 'ok' || scenario === 'ok-site-change' ? null : FIXTURE_PROBLEMS[scenario] ?? null;
  const failAt = found ? CHECK_KEYS.indexOf(found.stage) : CHECK_KEYS.length;
  const checks = CHECK_KEYS.map((key, index) => ({
    key,
    label: CHECK_LABELS[key],
    state: (index < failAt ? 'ok' : index === failAt ? 'fail' : 'skipped') as SetupCheck['state'],
  }));
  const identity = failAt > CHECK_KEYS.indexOf('auth') ? { name: '編輯小明', slug: 'ming', roles: [found ? 'contributor' : 'editor'] } : null;
  return {
    ok: found === null,
    url: lastTestedUrl,
    checks,
    problem: found?.problem ?? null,
    warnings: [],
    identity,
    testId: found === null ? FIXTURE_TEST_ID : null,
    siteChange:
      scenario === 'ok-site-change'
        ? { from: 'https://old.example.com', to: lastTestedUrl, publishedJobs: 12, uploadedMedia: 5 }
        : null,
  };
}

const FIXTURE_SETUP_AGENTS: SetupAgent[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    installed: true,
    version: 'codex-cli 0.153.4',
    loginState: 'logged-in',
    available: true,
    unavailableReason: null,
    canGenerateImages: true,
    installCommand: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    installNote: '要有 ChatGPT 付費訂閱（Plus 以上）。用 Homebrew 的話也可以 brew install codex。',
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    installed: true,
    version: '2.1.247',
    loginState: 'logged-out',
    available: false,
    unavailableReason: '尚未登入，請執行 `claude auth login`',
    canGenerateImages: false,
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude auth login',
    installNote: '要有 Claude 付費訂閱（Pro 以上）。',
  },
  {
    id: 'google',
    displayName: 'Antigravity',
    installed: false,
    version: null,
    loginState: 'unknown',
    available: false,
    unavailableReason: '找不到 agy，請先安裝官方 CLI 並確認它在 PATH 上',
    canGenerateImages: false,
    installCommand: '從 https://antigravity.google 下載安裝 Antigravity',
    loginCommand: 'agy models',
    installNote: '裝好後終端機要找得到 agy 指令。第一次跑 agy 會要你登入 Google 帳號；agy models 列得出模型就代表登入好了。',
  },
];
