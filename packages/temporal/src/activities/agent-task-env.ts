import type { AgentTaskProvider } from "#shared/agent-task.ts";

// Every secret value that might pass through an agent-task run, listed so the
// subprocess output redactor can scrub them from logs/results. This is the
// belt-and-suspenders redaction list; the actual environment the subprocess
// receives is the much smaller allowlist built by envForProvider below.
export function agentTaskSecretTokens(
  githubAppToken: string | undefined,
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): readonly (string | undefined)[] {
  return [
    env["CLAUDE_CODE_OAUTH_TOKEN"],
    env["ANTHROPIC_API_KEY"],
    env["CODEX_API_KEY"],
    env["OPENAI_API_KEY"],
    env["GITHUB_PERSONAL_ACCESS_TOKEN"],
    env["GITHUB_APP_PRIVATE_KEY"],
    githubAppToken,
    env["POSTAL_API_KEY"],
    env["PAGERDUTY_TOKEN"],
    env["BUGSINK_TOKEN"],
    env["GRAFANA_API_KEY"],
    env["ARGOCD_AUTH_TOKEN"],
    env["CLOUDFLARE_API_TOKEN"],
  ];
}

// Non-secret process/runtime vars the provider CLIs need to actually execute:
// locate their binaries (PATH), read per-user config (HOME/XDG/CODEX_HOME),
// honour locale/timezone, and trust the system CA store. `Bun.spawn(env)`
// REPLACES the environment (it is not merged with the parent), so these must
// be forwarded explicitly or the subprocess cannot even find `codex`/`claude`.
const PROVIDER_RUNTIME_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
];

// The ONLY credential each provider is allowed to see is its own model API key.
// Everything else the worker holds (Postal, PagerDuty, Bugsink, Grafana,
// ArgoCD, Cloudflare, the other provider's key, the GitHub PAT/App private key)
// is deliberately withheld — see envForProvider for why.
const PROVIDER_CREDENTIAL_ALLOWLIST: Record<
  AgentTaskProvider,
  readonly string[]
> = {
  claude: ["CLAUDE_CODE_OAUTH_TOKEN"],
  codex: ["CODEX_API_KEY", "OPENAI_API_KEY"],
};

// Build the subprocess environment from a strict ALLOWLIST rather than
// forwarding nearly all of the worker's env. The agent-task run has no
// OS-level sandbox (Codex's --sandbox needs bwrap to create a Linux namespace,
// which the unprivileged worker pod refuses — see agent-task-command.ts), so a
// prompt-injected or mistaken command runs with whatever this returns. Bounding
// it to {runtime vars + the provider's own model key + a freshly minted,
// short-lived GitHub App token} keeps that blast radius small: the operational
// secrets the worker carries for its other workflows are never exposed, so an
// injected command cannot exfiltrate or misuse them.
export function envForProvider(
  provider: AgentTaskProvider,
  githubAppToken: string,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const allowed = new Set<string>([
    ...PROVIDER_RUNTIME_ENV_ALLOWLIST,
    ...PROVIDER_CREDENTIAL_ALLOWLIST[provider],
  ]);
  const env: Record<string, string> = {};
  for (const key of allowed) {
    const value = sourceEnv[key];
    if (typeof value === "string" && value !== "") {
      env[key] = value;
    }
  }
  // The GitHub App installation token is minted per-run and injected
  // explicitly — never inherited from the worker env (which is exactly why no
  // GH_TOKEN / GITHUB_PERSONAL_ACCESS_TOKEN / GITHUB_APP_* var is allowlisted).
  env["GH_TOKEN"] = githubAppToken;
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
