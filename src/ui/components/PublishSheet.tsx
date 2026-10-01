import { useEffect, useState, type JSX } from 'react';
import { api } from '../service/client.js';
import type { LoadedJob, PublishResult, PublishStatus } from '../service/types.js';
import { Icon } from '../icons.js';
import { shortHash } from '../lib/format.js';
import { openContradictionNotice } from '../../contract/factcheck.js';
import { typeLabel } from './JobList.js';
import { TaxonomyPanel } from './panels/TaxonomyPanel.js';
import { ErrorNote, Spinner, useAction } from './panels/shared.js';
import { AuthorPicker, authorBlocker, useAuthors } from './AuthorPicker.js';

/**
 * 發布面板（B2，決策 D-013）。從右邊滑出，左邊的文章切到「成品」。
 *
 * 由上往下是一次發布要確認的全部事情：發到哪裡、還有什麼沒處理、分類、封面、
 * 怎麼發。最後一顆按鈕把「核准」與「發布」合在一起，但兩條規則一條都沒少：
 *
 * 1. **人一定看過才准核准。** 打開面板時左邊切到成品；稿子還沒渲染就先渲染，
 *    校樣重載之後後端才會推進 PREVIEWED（docs/specs/state-machine.md）。
 * 2. **核准綁的是畫面上那一份。** 送出的 hash 必須等於校樣回應的 ETag；對不上就代表
 *    你在看的跟你要簽的不是同一份，這時不給按。
 *
 * **公開是唯一收不回來的動作**：站上的 MailPoet／Jetpack 可能在公開的瞬間寄出電子報、
 * 自動分享（docs/specs/security.md）。所以預設存成草稿，選公開要多勾一個「我知道」。
 */

const NEEDS_RENDER = new Set(['SOURCE', 'REVIEWED', 'MEDIA_READY']);

/**
 * 這些 blocker 面板自己會處理（渲染、核准）或另外列出來（建議、封面），不再原樣重複。
 *
 * ⚠️ 比對的是後端 `blockersFor` 產生的中文字串——後端改字，這裡就認不得，會把它當成
 * 硬性阻擋列出來（寧可多擋，不會少擋）。長久的解法是讓後端回結構化代碼。
 */
const HANDLED_BLOCKER =
  /^(還有 \d+ 項校稿建議|這個發布目標必須設定精選圖片|內容改過了，核准已失效|還沒渲染|還沒看過校樣|還沒核准|正在發布中|已經發布過了)/;

export function PublishSheet({
  job,
  refresh,
  previewHash,
  onGoTo,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  /** 校樣回應的 ETag。null = 還沒問到或後端沒給，這時不阻擋，只是不做保證。 */
  previewHash: string | null;
  /** 「回去看」：關掉面板，跳到建議清單或圖片區。 */
  onGoTo: (where: 'review' | 'images') => void;
}): JSX.Element {
  const [status, setStatus] = useState<PublishStatus>('draft');
  const [understood, setUnderstood] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [step, setStep] = useState<string | null>(null);
  // 作者是發布選項（P5-T024）：null＝用這個站的預設作者（後端決定），改了只影響這一篇。
  const [authorId, setAuthorId] = useState<number | null>(null);
  const authors = useAuthors();
  const prepare = useAction();
  const go = useAction();

  // 還沒渲染的稿子先渲染一次：左邊的「成品」才是真正會送出去的樣子。
  useEffect(() => {
    if (!NEEDS_RENDER.has(job.state) || job.currentRevision === null) return;
    void prepare.run(async () => {
      await api.render(job.uuid);
      await refresh();
    });
    // 只在打開面板、而且狀態還沒渲染時跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (job.state === 'PUBLISHING') {
    return (
      <p className="agent-running" role="status">
        <Spinner />
        <span>正在送去 WordPress…</span>
      </p>
    );
  }

  if (job.published) return <Published job={job} result={result} account={authors.data?.currentUser.name ?? null} />;

  const hash = job.currentRevision?.contentHash ?? null;
  const pending = job.review?.pendingCount ?? 0;
  const briefsLeft = job.imageBriefs.filter((brief) => !brief.fulfilled).length;
  const needsCover = job.target.requireFeaturedImage && job.featuredMediaId === null;
  const otherBlockers = job.blockers.filter((blocker) => !HANDLED_BLOCKER.test(blocker));
  const cover = job.media.find((asset) => asset.id === job.featuredMediaId) ?? null;
  // AI 查證「說法不同」還沒處理的（D-034）：只提醒、不擋，跟校稿建議一樣（Q-1 現況）。
  const factNotice = openContradictionNotice(job.openFactCheckContradictions ?? 0);

  const approvedNow = job.state === 'APPROVED' && job.approval?.valid === true;
  const seen = job.state === 'PREVIEWED' || approvedNow;
  const mismatch = hash !== null && previewHash !== null && previewHash !== hash;
  const torn = job.approval !== null && !job.approval.valid;

  const why: string | null = needsCover
    ? '還缺封面圖：這個發布目標一定要有精選圖片。'
    : otherBlockers.length > 0
      ? `還不能發布：${otherBlockers.join('、')}`
      : mismatch
        ? '左邊的成品跟要核准的不是同一份（內容剛被改過）。按「重新整理成品」再看一次。'
        : !seen
          ? prepare.busy || NEEDS_RENDER.has(job.state) || job.state === 'RENDERED'
            ? '正在準備成品，左邊載入完就能按。'
            : `目前狀態是「${job.state}」，這一步不能發布。`
          : status === 'publish' && !understood
            ? '要先勾上面的「我知道」。'
            : authorBlocker(authors, authorId);

  const publish = (): void =>
    void go.run(async () => {
      try {
        if (!approvedNow) {
          if (hash === null) return;
          setStep('核准中…');
          await api.approve(job.uuid, hash);
        }
        setStep('送去 WordPress…');
        // confirm: true 就是「使用者剛剛在這個面板按了發布」。設了
        // requireSecondConfirmation 的目標，後端只認這個旗標。
        setResult(
          await api.publish(job.uuid, { status, confirm: true, ...(authorId === null ? {} : { authorId }) }),
        );
      } finally {
        setStep(null);
        await refresh();
      }
    });

  return (
    <div className="publish">
      <section className="p-section">
        <h3 className="p-label">
          <span className="p-num">1</span>發到哪裡・作者
        </h3>
        <div className="p-dest">
          <Icon name="globe" size={18} />
          <span className="p-dest-main">
            <b>{job.target.displayName}</b>
            <span>
              因為這篇是「{typeLabel(job.target.contentType, job.target.postType)}」・WordPress 裡的{' '}
              <span className="mono">{job.target.postType}</span>
            </span>
          </span>
        </div>
        <p className="field-hint">類型在建稿時就決定了，發布時不用再選。</p>
        <AuthorPicker state={authors} chosen={authorId} onChoose={setAuthorId} />
      </section>

      {(pending > 0 || factNotice !== null || briefsLeft > 0 || needsCover || otherBlockers.length > 0) && (
        <section className="p-section">
          <h3 className="p-label">
            <span className="p-num">2</span>還沒處理的
          </h3>
          <ul className="p-todo">
            {pending > 0 && (
              <li data-tone="warn">
                <span>還有 {pending} 項修改建議沒看</span>
                <button type="button" className="btn btn-quiet btn-tiny" onClick={() => onGoTo('review')}>
                  回去看
                </button>
              </li>
            )}
            {factNotice !== null && (
              <li data-tone="warn">
                <span>{factNotice}</span>
                <button type="button" className="btn btn-quiet btn-tiny" onClick={() => onGoTo('review')}>
                  回去看
                </button>
              </li>
            )}
            {needsCover && (
              <li data-tone="bad">
                <span>還缺封面圖（一定要有）</span>
                <button type="button" className="btn btn-quiet btn-tiny" onClick={() => onGoTo('images')}>
                  去選
                </button>
              </li>
            )}
            {briefsLeft > 0 && (
              <li>
                <span>AI 建議的 {briefsLeft} 張配圖還沒放</span>
                <button type="button" className="btn btn-quiet btn-tiny" onClick={() => onGoTo('images')}>
                  回去看
                </button>
              </li>
            )}
            {otherBlockers.map((blocker) => (
              <li key={blocker} data-tone="bad">
                <span>{blocker}</span>
              </li>
            ))}
          </ul>
          {(pending > 0 || factNotice !== null) && !needsCover && (
            <p className="field-hint">沒看完也能發：建議與查證只是提醒，不會擋住你。</p>
          )}
        </section>
      )}

      {job.target.taxonomy !== null && (
        <section className="p-section">
          <h3 className="p-label">
            <span className="p-num">3</span>
            {job.target.contentType === 'longform' ? '標籤' : '分類'}
          </h3>
          <TaxonomyPanel job={job} refresh={refresh} />
        </section>
      )}

      <section className="p-section">
        <h3 className="p-label">
          <span className="p-num">4</span>封面
        </h3>
        <div className="p-cover">
          {cover ? (
            <>
              {cover.url ? (
                <img className="p-cover-thumb" src={cover.url} alt={cover.altText ?? ''} />
              ) : (
                <span className="p-cover-thumb p-cover-empty">
                  <Icon name="image" size={18} />
                </span>
              )}
              <span className="p-cover-text">{cover.altText ?? '已選封面圖'}</span>
            </>
          ) : (
            <span className="p-cover-text dim">
              {job.target.requireFeaturedImage ? '還沒有封面圖。' : '沒有封面圖（這個類型可以不放）。'}
            </span>
          )}
          <button type="button" className="btn btn-quiet btn-tiny" onClick={() => onGoTo('images')}>
            {cover ? '換一張' : '去選'}
          </button>
        </div>
      </section>

      <section className="p-section">
        <h3 className="p-label">
          <span className="p-num">5</span>怎麼發
        </h3>
        <div className="p-ways" role="radiogroup" aria-label="發布方式">
          <button
            type="button"
            role="radio"
            aria-checked={status === 'draft'}
            className="p-way"
            data-active={status === 'draft' ? 'yes' : 'no'}
            onClick={() => setStatus('draft')}
          >
            <b>存成草稿</b>
            <span>網站上看不到，之後在 WordPress 後台還能改</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={status === 'publish'}
            className="p-way"
            data-active={status === 'publish' ? 'yes' : 'no'}
            data-danger="yes"
            onClick={() => setStatus('publish')}
          >
            <b>馬上公開</b>
            <span>立刻出現在網站上</span>
          </button>
        </div>

        {status === 'publish' && (
          <div className="p-warn" role="alert">
            <p>
              <Icon name="alert" size={16} />
              <span>
                公開的瞬間可能<b>自動寄出電子報</b>、<b>分享到社群</b>。之後就算刪掉文章也收不回來。
              </span>
            </p>
            <label className="p-check">
              <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
              我知道，確定要公開
            </label>
          </div>
        )}
      </section>

      {torn && (
        <p className="note note-warn">
          <Icon name="scissors" size={14} />
          <span>內容在上次核准之後又改過，舊的核准已經作廢。這次按下去會重新核准現在這一份。</span>
        </p>
      )}

      <ErrorNote message={prepare.error ?? go.error} />

      <div className="p-go">
        <button
          type="button"
          className="btn btn-primary btn-big p-go-btn"
          data-danger={status === 'publish' ? 'yes' : 'no'}
          disabled={why !== null || go.busy || prepare.busy}
          onClick={publish}
        >
          {go.busy ? <Spinner /> : <Icon name={status === 'publish' ? 'send' : 'check'} size={16} />}
          {step ?? (approvedNow ? '' : '核准並') + (status === 'publish' ? '公開' : '存成草稿')}
        </button>
        <p className="p-why" aria-live="polite">
          {why ?? (
            <>
              核准會綁住現在這一版 <span className="mono">{shortHash(hash)}</span>
              ；之後再改一個字就要重新核准。
            </>
          )}
        </p>
        {mismatch && (
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            onClick={() =>
              void prepare.run(async () => {
                await api.render(job.uuid);
                await refresh();
              })
            }
          >
            <Icon name="refresh" size={13} />
            重新整理成品
          </button>
        )}
      </div>
    </div>
  );
}

function Published({
  job,
  result,
  account,
}: {
  job: LoadedJob;
  result: PublishResult | null;
  /** 發布台登入的帳號名稱；沒送作者時 WordPress 記成它，要寫出來（P5-T024 審查）。 */
  account: string | null;
}): JSX.Element {
  const published = job.published!;
  return (
    <div className="publish">
      <p className="note note-good">
        <Icon name="check-circle" size={16} />
        <span>
          已送到「{job.target.displayName}」，狀態是{published.status === 'publish' ? '公開' : '草稿'}
          <span className="mono"> #{published.wordpressId}</span>
          {result === null
            ? ''
            : result.author
              ? `，作者是 ${result.author.name}`
              : `，作者是發布台的帳號${account ? `（${account}）` : ''}`}
        </span>
      </p>
      {result && result.unknownTerms.length > 0 && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            站上沒有「{result.unknownTerms.join('」「')}」這個分類項目，這次沒有套上。
            到 WordPress 後台補上，或下次改選既有的項目。
          </span>
        </p>
      )}
      {result && result.fallbackBlocks > 0 && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            有 {result.fallbackBlocks} 個區塊轉不成 Gutenberg 區塊，改用原始 HTML 送出。
            在 WordPress 編輯器裡它們會顯示成「自訂 HTML」，可以編輯但不是區塊。
          </span>
        </p>
      )}
      <a className="btn btn-primary" href={published.link} target="_blank" rel="noreferrer">
        <Icon name="external-link" size={14} />
        在 WordPress 打開
      </a>
      <p className="mono publish-link">{published.link}</p>
    </div>
  );
}
