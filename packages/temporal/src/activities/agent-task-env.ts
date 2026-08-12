import type { AgentTaskProvider } from "#shared/agent-task.ts";

const MOUNTED_SECRET_PATHS = [
  "/var/run/secrets/kubernetes.io/serviceaccount/token",
  "/etc/talos/config",
] as const;
const AGENT_TASK_COMMON_ENVIRONMENT = new Set([
  "ALERT_DASHBOARD_URL",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DISABLE_AUTOUPDATER",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PROMETHEUS_URL",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
]);
const REPORT_DELIVERY_BOUNDARY_ENVIRONMENT = new Set([
  "RECIPIENT_EMAIL",
  "SENDER_EMAIL",
  "AGENT_TASK_API_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "XCODE_CLOUD_WEBHOOK_TOKEN",
]);

// Direct inference-provider keys. No agent may inherit one from the worker.
const DIRECT_PROVIDER_CREDENTIAL_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
]);

// The subscription credential each native agent SDK authenticates with.
const PROVIDER_CREDENTIAL_KEYS: Record<AgentTaskProvider, string> = {
  claude: "CLAUDE_CODE_OAUTH_TOKEN",
  codex: "CODEX_ACCESS_TOKEN",
};
const AGENT_SUBSCRIPTION_CREDENTIAL_KEYS = new Set<string>(
  Object.values(PROVIDER_CREDENTIAL_KEYS),
);

// Every inference credential the worker holds, direct or subscription. An
// agent is given exactly one of these explicitly; it must never inherit
// another provider's credential just because the worker also holds it.
function isProviderCredentialKey(key: string): boolean {
  return (
    DIRECT_PROVIDER_CREDENTIAL_KEYS.has(key) ||
    AGENT_SUBSCRIPTION_CREDENTIAL_KEYS.has(key)
  );
}

export function isReportDeliveryBoundaryEnvironmentKey(key: string): boolean {
  return (
    key.startsWith("POSTAL_") || REPORT_DELIVERY_BOUNDARY_ENVIRONMENT.has(key)
  );
}

function isAgentTaskCommonEnvironmentKey(key: string): boolean {
  return (
    AGENT_TASK_COMMON_ENVIRONMENT.has(key) ||
    key.startsWith("KUBERNETES_SERVICE_")
  );
}

function secretFragments(value: string): readonly string[] {
  // Kubernetes and PEM credentials are often passed through env files with
  // escaped newlines. Tokenize both representations so a multiline secret
  // cannot be reconstructed one line at a time in diagnostic output.
  const decodedWhitespace = decodeEscapedWhitespace(value);
  return decodedWhitespace
    .split(/[\s"'{}\u{005B}\u{005D},:=]+/u)
    .filter((fragment) => fragment.length >= 8);
}

function decodeEscapedWhitespace(value: string): string {
  return value
    .replaceAll(String.raw`\n`, "\n")
    .replaceAll(String.raw`\r`, "\r")
    .replaceAll(String.raw`\t`, "\t");
}

// Scrub every worker value rather than maintaining a partial credential-name
// list. This protects parent-process diagnostics and covers credentials
// embedded in structured values such as DATABASE_URL.
function compositeSecretTokens(value: string): readonly string[] {
  const tokens = [value, ...secretFragments(value)];
  try {
    const url = new URL(value);
    for (const component of [url.username, url.password]) {
      if (component !== "") {
        tokens.push(component);
        tokens.push(decodeURIComponent(component));
      }
    }
    for (const component of url.searchParams.values()) {
      tokens.push(component);
      tokens.push(decodeURIComponent(component));
    }
  } catch {
    // Non-URL values are still covered by the complete-value token.
  }
  return tokens;
}

export async function readAgentTaskMountedSecretTokens(
  paths: readonly string[] = MOUNTED_SECRET_PATHS,
): Promise<readonly string[]> {
  const tokens: string[] = [];
  for (const path of paths) {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      continue;
    }

    const contents = await file.text();
    const token = contents.trim();
    if (token === "") {
      continue;
    }
    tokens.push(token);
    tokens.push(...secretFragments(token));
  }
  return tokens;
}

export function agentTaskSecretTokens(
  githubAppToken: string | undefined,
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  mountedSecretTokens: readonly string[] = [],
): readonly (string | undefined)[] {
  // Mounted service-account/Talos files are read into this same redaction set
  // by createAgentTaskSecretTokenState. Keeping them in the returned list is
  // what protects final-text excerpts when a provider violates its contract.
  const environmentSecretTokens = Object.values(env).flatMap((value) =>
    value === undefined ? [] : compositeSecretTokens(value),
  );
  const tokens: (string | undefined)[] = [
    ...environmentSecretTokens,
    ...mountedSecretTokens,
  ];
  tokens.push(githubAppToken);
  return tokens;
}

export type AgentTaskSecretTokenState = {
  tokens: (string | undefined)[];
  refresh: () => Promise<void>;
};

export class AgentTaskSecretRedactionError extends Error {
  constructor(cause: unknown) {
    super("agent-task secret redaction refresh failed", { cause });
    this.name = "AgentTaskSecretRedactionError";
  }
}

export class AgentTaskSecretRedactionController {
  readonly abortController = new AbortController();
  failure: AgentTaskSecretRedactionError | undefined;

  constructor(private readonly onFailure: () => void) {}

  record(cause: unknown): void {
    if (this.failure !== undefined) {
      return;
    }
    this.failure = new AgentTaskSecretRedactionError(cause);
    this.onFailure();
    this.abortController.abort(this.failure);
  }

  async refreshBeforeOutput(
    state: AgentTaskSecretTokenState,
  ): Promise<boolean> {
    try {
      await state.refresh();
      return this.failure === undefined;
    } catch (error: unknown) {
      this.record(error);
      return false;
    }
  }
}

export async function createAgentTaskSecretTokenState(
  githubAppToken: string | undefined,
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  paths: readonly string[] = MOUNTED_SECRET_PATHS,
): Promise<AgentTaskSecretTokenState> {
  const tokens = [
    ...agentTaskSecretTokens(
      githubAppToken,
      env,
      await readAgentTaskMountedSecretTokens(paths),
    ),
  ];
  let refreshInFlight: Promise<void> | undefined;
  const refresh = (): Promise<void> => {
    if (refreshInFlight !== undefined) {
      return refreshInFlight;
    }
    const refreshRun = (async (): Promise<void> => {
      const nextSecretTokens = agentTaskSecretTokens(
        githubAppToken,
        env,
        await readAgentTaskMountedSecretTokens(paths),
      );
      for (const token of nextSecretTokens) {
        if (!tokens.includes(token)) {
          tokens.push(token);
        }
      }
    })();
    refreshInFlight = (async (): Promise<void> => {
      try {
        await refreshRun;
      } finally {
        refreshInFlight = undefined;
      }
    })();
    return refreshInFlight;
  };
  return { tokens, refresh };
}

export async function refreshAgentTaskSecretTokenStateInBackground(
  state: AgentTaskSecretTokenState,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await state.refresh();
  } catch (error: unknown) {
    onError(error);
  }
}

// Build the deliberately small environment for a native agent SDK run. The SDK
// child process inherits nothing by default: only basic process/TLS settings,
// non-secret evidence endpoints, the dedicated read-only Kubernetes identity,
// and the one subscription credential its own provider needs. Every other
// worker credential — Postal, S3, GitHub, Temporal, Talos — stays out, so a
// prompt-injected agent has nothing to exfiltrate from its own environment.
export function envForProvider(
  provider: AgentTaskProvider,
  workdir: string,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== "string") {
      continue;
    }
    if (isAgentTaskCommonEnvironmentKey(key)) {
      env[key] = value;
    }
  }
  env["HOME"] = workdir;
  const credentialKey = PROVIDER_CREDENTIAL_KEYS[provider];
  const credential = sourceEnv[credentialKey];
  if (credential === undefined || credential === "") {
    throw new Error(`${credentialKey} is required for ${provider} agent tasks`);
  }
  env[credentialKey] = credential;
  return env;
}

// Environment for a trusted, source-controlled agent (homelab audit, Scout
// season refresh) whose prompt is not attacker-influenced and which genuinely
// needs the worker's operational credentials. Unlike envForProvider this is a
// denylist, but the three categories it removes are the ones an agent must
// never hold: the bot's own GitHub credentials (callers re-mint a short-lived
// installation token), report-delivery credentials, and every inference
// credential. That last category covers the other SDK's subscription token as
// well as direct API keys — these agents have Bash, so leaving an unrelated
// provider credential in reach is exfiltratable. Callers pass the one
// credential their own provider needs through `overrides`.
export function envForTrustedAgent(
  overrides: Readonly<Record<string, string>>,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== "string") {
      continue;
    }
    if (
      key === "GH_TOKEN" ||
      key === "GITHUB_PERSONAL_ACCESS_TOKEN" ||
      key.startsWith("GITHUB_APP_") ||
      isProviderCredentialKey(key) ||
      isReportDeliveryBoundaryEnvironmentKey(key)
    ) {
      continue;
    }
    env[key] = value;
  }
  return { ...env, ...overrides };
}

// Deterministic evidence collectors run with the same small read-only runtime
// environment as provider subprocesses, but receive no provider broker token.
// Their argv comes from the authenticated/source-controlled task definition,
// never from model output.
export function envForEvidenceCollector(
  workdir: string,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value === "string" && isAgentTaskCommonEnvironmentKey(key)) {
      env[key] = value;
    }
  }
  env["HOME"] = workdir;
  return env;
}
