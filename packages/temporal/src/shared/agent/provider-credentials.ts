import type { AgentTaskProvider } from "./agent-task.ts";

// Direct inference-provider keys. No agent may inherit one from the worker.
export const DIRECT_PROVIDER_CREDENTIAL_KEYS = [
  "ANTHROPIC_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_API_KEY",
  "CODEX_AUTH_JSON_B64",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
] as const;

export const PROVIDER_CREDENTIAL_KEYS = {
  claude: "CLAUDE_CODE_OAUTH_TOKEN",
  codex: "OPENAI_API_KEY",
} as const satisfies Record<AgentTaskProvider, string>;

// Every inference credential the worker can hold, direct or subscription.
export const PROVIDER_CREDENTIAL_ENV_VARS = [
  ...DIRECT_PROVIDER_CREDENTIAL_KEYS,
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

const PROVIDER_CREDENTIAL_ENV_VAR_SET = new Set<string>(
  PROVIDER_CREDENTIAL_ENV_VARS,
);

export function isProviderCredentialKey(key: string): boolean {
  return PROVIDER_CREDENTIAL_ENV_VAR_SET.has(key);
}
