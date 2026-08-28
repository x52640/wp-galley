import type {
  AddMediaInput,
  AgentReviewInput,
  AgentRunResult,
  Approval,
  CreateJobInput,
  CreateRevisionInput,
  JobDetail,
  JobSummary,
  JobTarget,
  MediaAsset,
  ProofMark,
  PublisherApi,
  PublishInput,
  PublishResult,
  RenderOutcome,
  Revision,
  Term,
} from './types.js';

/** 示範資料多帶兩個欄位，因為 JobSummary 需要而 JobDetail 沒有。 */
interface FixtureJob extends JobDetail {
  target: JobTarget;
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
 * 誤認成真的 job。
 */

const DIARY_TARGET: JobTarget = {
  key: 'diary',
  displayName: '日•記',
  contentType: 'diary',
  taxonomy: 'diary-category',
  requireFeaturedImage: false,
  allowCreateTerms: false,
};

const LONGFORM_TARGET: JobTarget = {
  key: 'read-think',
  displayName: '思想•讀•鑰（長文）',
  contentType: 'longform',
  taxonomy: 'read-think-tag',
  requireFeaturedImage: true,
  allowCreateTerms: false,
};

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
    sourceText: null,
    createdAt: '2026-08-27T14:00:00Z',
    updatedAt: '2026-08-28T10:02:00Z',
    ...overrides,
  };
}

function buildStore(): Map<string, FixtureJob> {
  const jobs: FixtureJob[] = [
    baseDiary('f-source', { state: 'SOURCE', blockers: ['尚未渲染'] }),
    baseDiary('f-reviewed', {
      state: 'REVIEWED',
      marks: DIARY_MARKS,
      currentRevision: revision(2, 'agent_review', { title: '20260828', slug: '20260828', body: DIARY_BODY }, '5c02f7ab91de4460'),
      agentRun: {
        status: 'succeeded',
        provider: 'claude',
        startedAt: '2026-08-28T09:38:00Z',
        finishedAt: '2026-08-28T09:39:10Z',
        errorMessage: null,
      },
      blockers: ['尚未渲染'],
    }),
    baseLongform('f-media', {
      state: 'MEDIA_READY',
      media: [media(41, '雨天的路口'), media(42, '回報流程圖', false)],
      featuredMediaId: null,
      blockers: ['這個發布目標必須設定精選圖片', '尚未渲染'],
    }),
    baseLongform('f-rendered', { state: 'RENDERED', blockers: ['尚未核准'] }),
    baseDiary('f-previewed', {
      state: 'PREVIEWED',
      marks: DIARY_MARKS,
      currentRevision: revision(2, 'agent_review', { title: '20260828', slug: '20260828', body: DIARY_BODY, category: '隨筆' }, '5c02f7ab91de4460'),
      agentRun: {
        status: 'succeeded',
        provider: 'codex',
        startedAt: '2026-08-28T09:38:00Z',
        finishedAt: '2026-08-28T09:39:02Z',
        errorMessage: null,
      },
      blockers: ['尚未核准'],
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
      blockers: ['核准已失效，請重新核准'],
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
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mustGet(uuid: string): FixtureJob {
  const job = store.get(uuid);
  if (!job) throw new Error(`示範資料裡沒有這個 job：${uuid}`);
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
    job.blockers = ['核准已失效，請重新核准'];
  }
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
    }));
  },

  async createJob(input: CreateJobInput): Promise<{ uuid: string }> {
    await delay();
    const uuid = `f-new-${store.size + 1}`;
    const target = input.targetKey === 'diary' ? DIARY_TARGET : LONGFORM_TARGET;
    const isDiary = target.key === 'diary';
    const job = (isDiary ? baseDiary : baseLongform)(uuid, {
      state: 'SOURCE',
      title: input.title ?? null,
      target,
      marks: [],
      media: [],
      featuredMediaId: null,
      approval: null,
      published: null,
      agentRun: null,
      blockers: ['尚未渲染'],
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
    return clone(mustGet(uuid));
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
      { ...(current?.templateData ?? {}), ...(input.templateData ?? {}) },
      nextHash(),
    );
    job.currentRevision = next;
    if (input.sourceText !== undefined) job.sourceText = input.sourceText;
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
    job.blockers = ['尚未核准'];
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

  async fetchPreview(uuid: string) {
    await delay(160);
    return previewDocument(mustGet(uuid));
  },

  async runAgent(uuid: string, input: AgentReviewInput): Promise<AgentRunResult> {
    const job = mustGet(uuid);
    const startedAt = new Date().toISOString();
    job.agentRun = { status: 'running', provider: input.provider, startedAt, finishedAt: null, errorMessage: null };
    await delay(1400);
    invalidateApproval(job, 'Agent 產生了新的內容');
    job.agentRun = {
      status: 'succeeded',
      provider: input.provider,
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: null,
    };
    job.state = 'REVIEWED';
    job.marks = job.target.key === 'diary' ? DIARY_MARKS : LONGFORM_MARKS;
    job.blockers = ['尚未渲染'];
    return { runId: 'fixture-run', status: 'succeeded', summary: '已套用建議', revision: job.currentRevision };
  },

  async cancelAgent(uuid: string) {
    await delay(100);
    const job = mustGet(uuid);
    if (job.agentRun) job.agentRun = { ...job.agentRun, status: 'cancelled' };
  },

  async addMedia(uuid: string, input: AddMediaInput) {
    await delay(500);
    const job = mustGet(uuid);
    invalidateApproval(job, '加了新的圖片');
    const asset: MediaAsset = {
      // 剛加進來還沒上傳到 WordPress，所以 url 是 null——這正是要練到的狀態。
      ...media(Math.floor(Math.random() * 900) + 100, input.altText ?? '', false),
      byteSize: input.file.size,
      mimeType: input.mimeType,
      ...(input.caption === undefined ? {} : { caption: input.caption }),
    };
    job.media = [...job.media, asset];
    return clone(asset);
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
    job.media = job.media.filter((asset) => asset.id !== assetId);
    if (job.featuredMediaId === assetId) job.featuredMediaId = null;
  },

  async placeMedia(uuid: string, assetId: number, afterBlockIndex: number) {
    await delay();
    const job = mustGet(uuid);
    invalidateApproval(job, '移動了圖片的位置');
    job.media = job.media.map((asset) =>
      asset.id === assetId ? { ...asset, placed: true, placedAfterBlockIndex: afterBlockIndex } : asset,
    );
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
    job.blockers = ['尚未核准'];
  },

  async publish(uuid: string, input: PublishInput): Promise<PublishResult> {
    const job = mustGet(uuid);
    job.state = 'PUBLISHING';
    await delay(1500);
    const result: PublishResult = {
      wordpressId: 1800 + Math.floor(Math.random() * 90),
      status: input.status,
      link: `https://www.remusplus.com/${job.target.key}/${job.title ?? 'untitled'}/`,
      created: true,
      unknownTerms: [],
      fallbackBlocks: 0,
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

  async listTargets() {
    await delay(80);
    return [LONGFORM_TARGET, DIARY_TARGET];
  },
};
