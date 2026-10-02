import type { AgentProvider } from '../service/types.js';

/**
 * 交給 Agent 的一鍵任務（決策 D-010：常做的事要一鍵）。
 *
 * 發文絕大多數是針對內容發的，校對只是順手做一次；每次都要先想一句話打進框裡
 * 才按得下去，等於把最常做的事變成最麻煩的事。所以「一鍵校驗」「只找錯字」「一鍵配圖」
 * 是直接送出的按鈕，打字那條路留給真的要交代事情的時候。
 *
 * 這裡打的字會變成 Agent 的 prompt，Agent 回的是結構化資料（JSON），HTML 一律由
 * 渲染器產生（docs/specs/security.md）。
 */

export const PROVIDERS: { id: AgentProvider; label: string }[] = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'google', label: 'Gemini' },
];

/**
 * 一鍵送出的兩件事，對應輸出契約的兩半。
 *
 * `changes` 是可以自動套用的字詞替換，`observations` 是要人判斷的觀察——
 * 兩者需要的注意力完全不同，硬塞成一顆按鈕只會兩邊都做不好。
 */
export const QUICK_TASKS = [
  {
    key: 'check' as const,
    label: '一鍵校驗',
    icon: 'sparkles' as const,
    hint: '錯字加疑點一起跑。多數時候按這一顆就好。',
    task: 'review' as const,
    primary: true,
    instruction:
      '完整跑一次：changes 放可以直接替換的錯字、別字、標點誤用與明顯語病；' +
      'observations 放需要我自己判斷的疑點——段落之間互相矛盾的說法、沒有註明出處的' +
      '引用與數據、前後兜不攏的年份或數字、讀者需要卻沒有交代的東西。' +
      '不確定的事一律寫進 observations，不要寫成 changes 假裝自己知道答案。' +
      '任何可能改變原意的修改都要把 meaningChanged 標成 true。',
  },
  {
    key: 'typo' as const,
    label: '只找錯字',
    icon: 'scissors' as const,
    hint: '錯字、標點、明顯的語病。不動語意，也不提疑點。',
    task: 'review' as const,
    primary: false,
    instruction:
      '只做校對：挑出錯字、別字、標點誤用與明顯的語病，逐項列進 changes。' +
      '不要改寫句子、不要調整段落、不要更動語氣或用詞偏好。' +
      '任何可能改變原意的修改都要把 meaningChanged 標成 true。' +
      'observations 給空陣列。',
  },
  {
    key: 'images' as const,
    label: '一鍵配圖',
    icon: 'image-plus' as const,
    hint: '想出該配什麼圖與生圖用的 prompt。不會產生圖片。',
    task: 'images' as const,
    primary: false,
    instruction:
      '只做配圖需求：讀完文章之後，把「哪一段該放什麼圖」寫進 imageBriefs。' +
      'prompt 要具體到可以直接貼進生圖工具（畫面內容、風格、光線、構圖），' +
      'placement 講清楚放在第幾段之後，altText 要能替代圖片本身。' +
      'changes 與 observations 給空陣列。',
  },
];

/**
 * 「一鍵查證」（D-034，P6-T005）：整篇交給 AI 挑最多 5 個值得查的說法，找來源、抓網頁、核對引文。
 * 不是校稿那條管線（`POST …/factchecks`），所以不放進 `QUICK_TASKS`；選單上跟它們並排。
 */
export const FACTCHECK_QUICK = {
  label: '一鍵查證',
  hint: '整篇挑最多 5 個說法，找來源、核對引文。通常 1～3 分鐘，用掉兩次額度；不會改文章。',
};

/** 畫面上的名字（Codex、Claude、Gemini）。`agentRun.provider` 是 id，講額度時要換成這個。 */
export function providerLabel(id: string): string {
  return PROVIDERS.find((option) => option.id === id)?.label ?? id;
}

export const PRESETS = [
  '把過長的段落拆開，每段一個重點。',
  '統一全形標點，並把口語的贅字拿掉。',
  '第二段太長，拆成兩段。',
];

const PROVIDER_KEY = 'publisher.agentProvider';

/** 記住上次用哪一家。讀不到（無痕視窗）就用 Claude。 */
export function loadProvider(): AgentProvider {
  try {
    const value = window.localStorage.getItem(PROVIDER_KEY);
    if (PROVIDERS.some((option) => option.id === value)) return value as AgentProvider;
  } catch {
    /* 無痕視窗會擋 localStorage。 */
  }
  return 'claude';
}

export function saveProvider(provider: AgentProvider): void {
  try {
    window.localStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    /* 記不住就算了，下次再選一次。 */
  }
}

export function agentStatusText(status: string): string {
  switch (status) {
    case 'failed':
      return '失敗了';
    case 'cancelled':
      return '被停止了';
    case 'timeout':
      return '逾時了';
    default:
      return `結束於 ${status}`;
  }
}

/**
 * 這一趟 Agent 在跑的時候，會不會因為內容被改而整趟作廢（校稿、一鍵配圖）。
 * 生圖與建議網址（D-026）不對著某一版文字做，不算。是的話，放進正文、設精選這類會建新版本的動作要鎖住。
 * 規則跟後端 `contentRunActive`、示範資料同一份，在共用契約（P5-T033）。
 */
export { runLocksContent } from '../../contract/agent-run.js';
