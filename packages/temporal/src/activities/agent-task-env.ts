import type { AgentTaskProvider } from "#shared/agent-task.ts";

const MOUNTED_SECRET_PATHS = [
  "/var/run/secrets/kubernetes.io/serviceaccount/token",
  "/etc/talos/config",
] as const;

// envForProvider deliberately forwards the full worker env, so scrub every
// forwarded value rather than maintaining a partial credential-name list. This
// also covers credentials embedded in values such as DATABASE_URL.
function compositeSecretTokens(value: string): readonly string[] {
  const tokens = [value];
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
    tokens.push(
      ...token.split(/\s+/).filter((fragment) => fragment.length >= 8),
    );
  }
  return tokens;
}

export function agentTaskSecretTokens(
  githubAppToken: string | undefined,
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  mountedSecretTokens: readonly string[] = [],
): readonly (string | undefined)[] {
  return [
    ...Object.values(env).flatMap((value) =>
      value === undefined ? [] : compositeSecretTokens(value),
    ),
    ...mountedSecretTokens,
    githubAppToken,
  ];
}

export type AgentTaskSecretTokenState = {
  tokens: (string | undefined)[];
  refresh: () => Promise<void>;
};

export async function createAgentTaskSecretTokenState(
  githubAppToken: string,
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
  onError: () => void,
): Promise<void> {
  try {
    await state.refresh();
  } catch {
    onError();
  }
}

// Build the subprocess environment for an agent-task provider run.
//
// ACCEPTED-RISK NOTE (owner decision, see PR #1860 Codex threads A & B):
// This forwards the FULL worker environment to the provider subprocess (minus
// the GitHub credentials it re-mints below). That includes the worker's
// operational secrets — GRAFANA_URL/GRAFANA_API_KEY, PAGERDUTY_TOKEN,
// ARGOCD_SERVER/ARGOCD_AUTH_TOKEN, BUGSINK_URL/BUGSINK_TOKEN,
// CLOUDFLARE_API_TOKEN, POSTAL_*, etc. This is deliberate: the daily
// `homelab-audit-daily` schedule runs as a report-only agent task
// (`HOMELAB_AUDIT_AGENT_TASK`, provider "claude") through this exact path and
// its runbook performs LIVE Grafana/Prometheus, PagerDuty, ArgoCD, Bugsink, and
// Cloudflare-`tofu plan` checks — it needs those credentials to produce a
// complete report. A minimal-env allowlist was tried and reverted precisely
// because it broke that audit; do not reintroduce one without also giving the
// audit task a way to keep its read-only credentials, or its report silently
// degrades.
//
// The tradeoff being accepted: there is no OS-level sandbox around the run
// (Codex's `--sandbox` needs bwrap to create a Linux namespace, which the
// unprivileged worker pod refuses — see agent-task-command.ts), so a
// prompt-injected or mistaken command runs with whatever this returns and could
// read those credentials or the mounted service-account token. The boundary is
// instead: `mode: "report-only"` (the prompt forbids mutation), an ephemeral
// non-root pod, and a throwaway per-run clone. Revisit this (e.g. per-task
// credential scoping or a separately isolated runner) if the threat model
// changes — mutating tasks, or untrusted callers reaching the `/agent-tasks`
// ingress.
export function envForProvider(
  provider: AgentTaskProvider,
  githubAppToken: string,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== "string") {
      continue;
    }
    // Claude billing: strip ANTHROPIC_API_KEY so `claude -p` bills the
    // subscription (CLAUDE_CODE_OAUTH_TOKEN), not direct-API credits.
    if (provider === "claude" && key === "ANTHROPIC_API_KEY") {
      continue;
    }
    // Never inherit the worker's GitHub credentials — GH_TOKEN is re-minted as a
    // short-lived GitHub App installation token below so actions attribute to
    // the app bot.
    if (
      key === "GH_TOKEN" ||
      key === "GITHUB_PERSONAL_ACCESS_TOKEN" ||
      key.startsWith("GITHUB_APP_")
    ) {
      continue;
    }
    env[key] = value;
  }
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
