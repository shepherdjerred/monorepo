import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import {
  scoutSeasonRefreshSubprocessExitTotal,
  scoutSeasonRefreshTokensTotal,
} from "#observability/metrics.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { parseClaudeResultMessage } from "#shared/claude-result.ts";
import { redactSecrets } from "#shared/redact.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
import { buildSeasonRefreshPrompt } from "./scout-season-refresh-prompt.ts";

const COMPONENT = "scout-season-refresh";
const HEARTBEAT_INTERVAL_MS = 10_000;

const ALLOWED_TOOLS = "WebFetch,WebSearch,Read,Edit,Bash,Glob,Grep";

export type ClaudeRunInput = {
  workdir: string;
  model: string;
  maxTurns: number;
  seasonsFile: string;
  seasonsTestFile: string;
  noDriftSentinel: string;
  driftedSentinel: string;
};

export type ClaudeRunResult = {
  exitCode: number;
  durationMs: number;
  costUsd: number | undefined;
  numTurns: number | undefined;
  resultText: string;
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
  if (info !== undefined) Object.assign(base, info);
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
    scope.setContext("scoutSeasonRefresh", { ...info, ...extra });
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

function secretTokens(): readonly (string | undefined)[] {
  return [
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"],
    Bun.env["ANTHROPIC_API_KEY"],
    Bun.env["GH_TOKEN"],
    Bun.env["GITHUB_PERSONAL_ACCESS_TOKEN"],
  ];
}

function buildSubprocessEnv(claudeToken: string): Record<string, string> {
  // Strip ANTHROPIC_API_KEY so the CLI uses the OAuth subscription rather
  // than billing direct-API credits. Matches pr-agent.ts.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (key === "ANTHROPIC_API_KEY") continue;
    if (typeof value === "string") env[key] = value;
  }
  env["CLAUDE_CODE_OAUTH_TOKEN"] = claudeToken;
  return env;
}

async function pumpStderr(
  stream: ReadableStream<Uint8Array>,
  tokens: readonly (string | undefined)[],
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length === 0) continue;
        jsonLog("info", "claude stderr", {
          line: redactSecrets(line, tokens),
        });
      }
    }
    if (buf.length > 0) {
      jsonLog("info", "claude stderr", {
        line: redactSecrets(buf, tokens),
      });
    }
  } catch (error: unknown) {
    jsonLog("warning", "stderr pump error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function recordTokenUsage(
  model: string,
  usage: {
    input_tokens?: number | undefined;
    output_tokens?: number | undefined;
    cache_creation_input_tokens?: number | undefined;
    cache_read_input_tokens?: number | undefined;
  },
): void {
  if (usage.input_tokens !== undefined) {
    scoutSeasonRefreshTokensTotal.inc(
      { model, direction: "input" },
      usage.input_tokens,
    );
  }
  if (usage.output_tokens !== undefined) {
    scoutSeasonRefreshTokensTotal.inc(
      { model, direction: "output" },
      usage.output_tokens,
    );
  }
  if (usage.cache_creation_input_tokens !== undefined) {
    scoutSeasonRefreshTokensTotal.inc(
      { model, direction: "cache_create" },
      usage.cache_creation_input_tokens,
    );
  }
  if (usage.cache_read_input_tokens !== undefined) {
    scoutSeasonRefreshTokensTotal.inc(
      { model, direction: "cache_read" },
      usage.cache_read_input_tokens,
    );
  }
}

export async function runClaude(
  input: ClaudeRunInput,
): Promise<ClaudeRunResult> {
  const claudeToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (claudeToken === undefined || claudeToken === "") {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required");
  }

  const prompt = buildSeasonRefreshPrompt({
    today: new Date().toISOString().slice(0, 10),
    workdir: input.workdir,
    seasonsFile: input.seasonsFile,
    seasonsTestFile: input.seasonsTestFile,
    noDriftSentinel: input.noDriftSentinel,
    driftedSentinel: input.driftedSentinel,
  });

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
    "--add-dir",
    input.workdir,
    "--max-turns",
    String(input.maxTurns),
    "--model",
    input.model,
  ];

  jsonLog("info", "Invoking claude -p for scout-season-refresh", {
    workdir: input.workdir,
    model: input.model,
    maxTurns: input.maxTurns,
  });

  const startMs = Date.now();
  const proc = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: input.workdir,
    env: buildSubprocessEnv(claudeToken),
  });

  const heartbeat = setInterval(() => {
    safeHeartbeat({ phase: "claude", elapsedMs: Date.now() - startMs });
  }, HEARTBEAT_INTERVAL_MS);

  let stdout: string;
  let exitCode: number;
  try {
    [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      pumpStderr(proc.stderr, secretTokens()),
      proc.exited,
    ]);
  } finally {
    clearInterval(heartbeat);
  }

  const durationMs = Date.now() - startMs;
  scoutSeasonRefreshSubprocessExitTotal.inc({ exit_code: String(exitCode) });

  if (exitCode !== 0) {
    const e = new Error(
      `claude -p exited with code ${String(exitCode)} for scout-season-refresh`,
    );
    captureWithContext(e, { exitCode, durationMs });
    throw e;
  }

  const resultMsg = parseClaudeResultMessage(stdout);
  if (resultMsg.is_error === true) {
    const e = new Error(
      `claude -p reported is_error=true for scout-season-refresh: ${resultMsg.result ?? "(no result text)"}`,
    );
    captureWithContext(e);
    throw e;
  }

  if (resultMsg.usage !== undefined) {
    recordTokenUsage(input.model, resultMsg.usage);
  }

  return {
    exitCode,
    durationMs,
    costUsd: resultMsg.total_cost_usd,
    numTurns: resultMsg.num_turns,
    resultText: resultMsg.result ?? "",
  };
}
