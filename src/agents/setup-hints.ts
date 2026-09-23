import type { AgentId } from './types.js';

/**
 * 設定精靈第二步給使用者看的安裝與登入指令（P8-T002）。
 *
 * **發布台不替使用者執行這些指令**（D-016 不包含「自動安裝或登入 CLI」）：畫面只把指令印出來，
 * 使用者自己到終端機跑。登入指令跟各 adapter 的 unavailableReason 講的是同一條。
 * 來源與驗證狀態見 docs/specs/agent-cli.md「設定精靈給的指令」。
 */
export interface AgentSetupHint {
  readonly installCommand: string;
  readonly loginCommand: string;
  readonly installNote: string | null;
}

export const AGENT_SETUP_HINTS: Record<AgentId, AgentSetupHint> = {
  codex: {
    installCommand: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    installNote: '要有 ChatGPT 付費訂閱（Plus 以上）。用 Homebrew 的話也可以 brew install codex。',
  },
  claude: {
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude auth login',
    installNote: '要有 Claude 付費訂閱（Pro 以上）。',
  },
  google: {
    installCommand: '從 https://antigravity.google 下載安裝 Antigravity',
    loginCommand: 'agy models',
    installNote: '裝好後終端機要找得到 agy 指令。第一次跑 agy 會要你登入 Google 帳號；agy models 列得出模型就代表登入好了。',
  },
};
