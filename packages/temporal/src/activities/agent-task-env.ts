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

// envForProvider deliberately forwards the full worker env, so scrub every
// forwarded value rather than maintaining a partial credential-name list. This
// also covers credentials embedded in values such as DATABASE_URL.
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

// Build the deliberately small subprocess environment for an agent-task run.
// Generic agents receive only their own provider credential, basic process/TLS
// settings, non-secret evidence endpoints, and the dedicated read-only
// Kubernetes identity. Delivery and operational credentials stay in the core
// worker, and the public repository checkout is unauthenticated.
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
    } else if (provider === "claude" && key === "CLAUDE_CODE_OAUTH_TOKEN") {
      env[key] = value;
    } else if (
      provider === "codex" &&
      (key === "CODEX_API_KEY" || key === "OPENAI_API_KEY")
    ) {
      env[key] = value;
    }
  }
  env["HOME"] = workdir;
  // Codex CLI reads CODEX_API_KEY, not OPENAI_API_KEY (verified 0.139 in-pod:
  // OPENAI-only → 401 Missing bearer; CODEX_API_KEY → turn.completed).
  if (
    provider === "codex" &&
    (env["CODEX_API_KEY"] === undefined || env["CODEX_API_KEY"] === "") &&
    env["OPENAI_API_KEY"] !== undefined &&
    env["OPENAI_API_KEY"] !== ""
  ) {
    env["CODEX_API_KEY"] = env["OPENAI_API_KEY"];
  }
  return env;
}
