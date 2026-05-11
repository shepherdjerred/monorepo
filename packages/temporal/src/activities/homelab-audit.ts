import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import {
  homelabAuditEmailSentTotal,
  homelabAuditSubprocessDurationSeconds,
  homelabAuditSubprocessExitTotal,
  homelabAuditTokensTotal,
} from "#observability/metrics.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { parseClaudeResultMessage } from "#shared/claude-result.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
import {
  buildAuditPrompt,
  loadRunbook,
  type SectionsFilter,
} from "./homelab-audit-prompts.ts";
import {
  buildAuditEmailSubject,
  extractAuditSubjectCounts,
  renderAuditMarkdownToHtml,
} from "#shared/markdown-to-html.ts";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";
import { redactSecrets } from "#shared/redact.ts";

const COMPONENT = "homelab-audit";

const HEARTBEAT_INTERVAL_MS = 10_000;

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TURNS = 80;

// Audit hits a wide tool surface (kubectl, talosctl, toolkit, tofu, gh) so we
// allow Bash + Read + Grep + Glob + the GitHub MCP namespace if it's wired up
// later. The actual security bound is layered:
//   1. The Bun.spawn env (no API key, only OAuth token + audit creds).
//   2. The cluster RBAC bound to the temporal-worker SA — strict read-only via
//      `temporal-worker-audit-reader` (see homelab/.../audit-rbac.ts).
//   3. The prompt itself, which forbids state-mutating commands.
// `--allowed-tools` narrows the model's tool selection at the CLI layer.
// `--dangerously-skip-permissions` only suppresses the *interactive*
// per-tool-call prompt (necessary for headless `claude -p`); it does not
// remove the allow-list. `--permission-mode acceptEdits` is redundant in
// this combination but is kept for parity with `pr-agent.ts`.
const ALLOWED_TOOLS = "Bash,Read,Grep,Glob,WebFetch,mcp__github__*";

export type HomelabAuditAgentInput = {
  /** ISO date for the audit. Defaults to today (UTC) when undefined. */
  date?: string;
  /** Section IDs to include, or "all". */
  sections?: SectionsFilter;
  /** Override the model (e.g. "claude-haiku-4-5-20251001" for cheap iteration). */
  model?: string;
  /** Override max-turns budget. */
  maxTurns?: number;
};

export type HomelabAuditAgentResult = {
  markdown: string;
  durationMs: number;
  numTurns: number | undefined;
  totalCostUsd: number | undefined;
  model: string;
};

export type HomelabAuditEmailInput = {
  date: string;
  markdown: string;
};

export type HomelabAuditEmailResult = {
  subject: string;
  messageId: string;
  recipientId: number | "unknown";
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const info = activityInfoOrUndefined();
  const base: Record<string, unknown> = {
    level,
    msg: message,
    component: COMPONENT,
    ...getTraceContext(),
    ...fields,
  };
  if (info !== undefined) {
    Object.assign(base, info);
  }
  console.warn(JSON.stringify(base));
}

function activityInfoOrUndefined(): Record<string, unknown> | undefined {
  try {
    const info = Context.current().info;
    return {
      workflow: info.workflowType,
      ...workflowExecutionContext(info),
      activity: info.activityType,
      attempt: info.attempt,
    };
  } catch {
    // Outside an activity (local dev script): no Temporal context to attach.
    return undefined;
  }
}

function captureWithContext(
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    const info = activityInfoOrUndefined();
    if (info !== undefined) {
      scope.setTag("workflow", String(info["workflow"]));
      scope.setTag("activity", String(info["activity"]));
    }
    scope.setContext("homelabAudit", { ...info, ...extra });
    Sentry.captureException(error);
  });
}

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Outside an activity (local dev script): heartbeats are a no-op.
  }
}

// Every secret the audit subprocess can plausibly leak through stderr — any
// 401 response, curl -v handshake, argocd verbose, or upstream library that
// echoes a header. Listed in priority order; redactSecrets is O(N tokens × M
// chars) so a fixed handful is fine.
function auditSecretTokens(): readonly (string | undefined)[] {
  return [
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"],
    Bun.env["ANTHROPIC_API_KEY"],
    Bun.env["PAGERDUTY_TOKEN"],
    Bun.env["BUGSINK_TOKEN"],
    Bun.env["GRAFANA_API_KEY"],
    Bun.env["ARGOCD_AUTH_TOKEN"],
    Bun.env["CLOUDFLARE_API_TOKEN"],
    Bun.env["GH_TOKEN"],
    Bun.env["GITHUB_PERSONAL_ACCESS_TOKEN"],
    Bun.env["POSTAL_API_KEY"],
  ];
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Spawn `claude -p` with the audit prompt and return its markdown body.
 *
 * Matches the lifecycle pattern from packages/temporal/src/activities/pr-agent.ts:
 * stderr line pump with token redaction, 10s activity heartbeats, JSON result
 * parsing, Sentry capture on failure, and Prometheus metrics for duration /
 * tokens / exit code.
 */
async function runAuditAgent(
  input: HomelabAuditAgentInput,
): Promise<HomelabAuditAgentResult> {
  const claudeToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (claudeToken === undefined || claudeToken === "") {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required");
  }

  const date = input.date ?? todayIsoDate();
  const sections = input.sections ?? "all";
  const model = input.model ?? DEFAULT_MODEL;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;

  const runbook = await loadRunbook();
  const prompt = buildAuditPrompt({ date, runbook, sections });

  const args = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "json",
    "--allowed-tools",
    ALLOWED_TOOLS,
    "--permission-mode",
    "acceptEdits",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(maxTurns),
    "--model",
    model,
  ];

  jsonLog("info", "Invoking claude -p for homelab audit", {
    date,
    sections: Array.isArray(sections) ? sections : sections,
    model,
    maxTurns,
  });

  const startMs = Date.now();
  const proc = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
    },
  });

  const heartbeat = setInterval(() => {
    safeHeartbeat({ phase: "agent", elapsedMs: Date.now() - startMs });
  }, HEARTBEAT_INTERVAL_MS);

  const secretTokens = auditSecretTokens();
  const stderrPump = (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length === 0) {
            continue;
          }
          jsonLog("info", "claude stderr", {
            line: redactSecrets(line, secretTokens),
          });
        }
      }
      if (buf.length > 0) {
        jsonLog("info", "claude stderr", {
          line: redactSecrets(buf, secretTokens),
        });
      }
    } catch (error: unknown) {
      jsonLog("warning", "stderr pump error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  let stdout: string;
  let exitCode: number;
  try {
    [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      stderrPump,
      proc.exited,
    ]);
  } finally {
    clearInterval(heartbeat);
  }

  const durationMs = Date.now() - startMs;
  const durationSeconds = durationMs / 1000;

  homelabAuditSubprocessDurationSeconds.observe(
    { model, exit_code: String(exitCode) },
    durationSeconds,
  );
  homelabAuditSubprocessExitTotal.inc({ exit_code: String(exitCode) });

  if (exitCode !== 0) {
    const e = new Error(
      `claude -p exited with code ${String(exitCode)} for homelab audit`,
    );
    captureWithContext(e, { exitCode, durationMs });
    throw e;
  }

  let resultMsg;
  try {
    resultMsg = parseClaudeResultMessage(stdout);
  } catch (error: unknown) {
    captureWithContext(error, { stdoutHead: stdout.slice(0, 500) });
    throw new Error(
      `Failed to parse claude --output-format json result: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (resultMsg.is_error === true) {
    const e = new Error(
      `claude -p reported is_error=true for homelab audit: ${resultMsg.result ?? "(no result text)"}`,
    );
    captureWithContext(e);
    throw e;
  }

  const usage = resultMsg.usage;
  if (usage !== undefined) {
    if (usage.input_tokens !== undefined) {
      homelabAuditTokensTotal.inc(
        { model, direction: "input" },
        usage.input_tokens,
      );
    }
    if (usage.output_tokens !== undefined) {
      homelabAuditTokensTotal.inc(
        { model, direction: "output" },
        usage.output_tokens,
      );
    }
    if (usage.cache_creation_input_tokens !== undefined) {
      homelabAuditTokensTotal.inc(
        { model, direction: "cache_create" },
        usage.cache_creation_input_tokens,
      );
    }
    if (usage.cache_read_input_tokens !== undefined) {
      homelabAuditTokensTotal.inc(
        { model, direction: "cache_read" },
        usage.cache_read_input_tokens,
      );
    }
  }

  const markdown = (resultMsg.result ?? "").trim();
  if (markdown.length === 0) {
    const e = new Error(
      "claude -p returned empty result for homelab audit — nothing to email",
    );
    captureWithContext(e, { exitCode, durationMs });
    throw e;
  }

  jsonLog("info", "homelab audit agent completed", {
    durationMs,
    exitCode,
    costUsd: resultMsg.total_cost_usd,
    numTurns: resultMsg.num_turns,
    markdownLength: markdown.length,
  });

  return {
    markdown,
    durationMs,
    numTurns: resultMsg.num_turns,
    totalCostUsd: resultMsg.total_cost_usd,
    model,
  };
}

async function sendAuditEmail(
  input: HomelabAuditEmailInput,
): Promise<HomelabAuditEmailResult> {
  const { recipient, sender } = resolvePostalAddresses();

  const counts = extractAuditSubjectCounts(input.markdown);
  const subject = buildAuditEmailSubject(input.date, counts);
  const htmlBody = renderAuditMarkdownToHtml(input.markdown);

  try {
    const result = await sendPostalEmail({
      to: recipient,
      from: sender,
      subject,
      htmlBody,
      tag: "homelab-audit",
    });
    homelabAuditEmailSentTotal.inc({ outcome: "success" });
    jsonLog("info", "Homelab audit email accepted by Postal", {
      subject: result.subject,
      messageId: result.messageId,
      recipientId: result.recipientId,
    });
    return {
      subject: result.subject,
      messageId: result.messageId,
      recipientId: result.recipientId,
    };
  } catch (error: unknown) {
    homelabAuditEmailSentTotal.inc({ outcome: "failure" });
    captureWithContext(error, { subject });
    throw error;
  }
}

export type HomelabAuditActivities = typeof homelabAuditActivities;

export const homelabAuditActivities = {
  async runHomelabAuditAgent(
    input: HomelabAuditAgentInput,
  ): Promise<HomelabAuditAgentResult> {
    return runAuditAgent(input);
  },
  async sendHomelabAuditEmail(
    input: HomelabAuditEmailInput,
  ): Promise<HomelabAuditEmailResult> {
    return sendAuditEmail(input);
  },
};
