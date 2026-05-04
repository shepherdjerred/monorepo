import path from "node:path";
import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import type { PrAgentInput } from "#shared/schemas.ts";
import {
  prAgentSubprocessDurationSeconds,
  prAgentSubprocessExitTotal,
  prAgentTokensTotal,
} from "#observability/metrics.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { parseClaudeResultMessage } from "./docs-groom-utils.ts";
import { buildReviewPrompt, buildSummaryPrompt } from "./pr-prompts.ts";

const COMPONENT = "pr-agent";

const HEARTBEAT_INTERVAL_MS = 10_000;
const MCP_CONFIG_DIR = "/tmp";
const MCP_SERVER_BINARY = "/usr/local/bin/github-mcp-server";

const REVIEW_MODEL = "claude-opus-4-7";
const SUMMARY_MODEL = "claude-haiku-4-5-20251001";
const REVIEW_MAX_TURNS = 30;
const SUMMARY_MAX_TURNS = 10;

const ALLOWED_TOOLS = "mcp__github__*";

type Kind = PrAgentInput["kind"];

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      ...workflowFields(),
      ...getTraceContext(),
      ...fields,
    }),
  );
}

function workflowFields(): Record<string, unknown> {
  const info = Context.current().info;
  return {
    workflow: info.workflowType,
    workflowId: info.workflowExecution.workflowId,
    runId: info.workflowExecution.runId,
    activity: info.activityType,
    attempt: info.attempt,
  };
}

function captureWithContext(
  error: unknown,
  kind: Kind,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    const info = Context.current().info;
    scope.setTag("workflow", info.workflowType);
    scope.setTag("activity", info.activityType);
    scope.setTag("component", COMPONENT);
    scope.setTag("kind", kind);
    scope.setContext("prAgent", {
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      attempt: info.attempt,
      kind,
      ...extra,
    });
    Sentry.captureException(error);
  });
}

export function redactToken(text: string, token?: string): string {
  if (token === undefined || token.length < 8) {
    return text;
  }
  return text.replaceAll(token, "***");
}

export function buildClaudeArgs(input: {
  prompt: string;
  mcpConfigPath: string;
  kind: Kind;
}): string[] {
  const { prompt, mcpConfigPath, kind } = input;
  return [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "json",
    "--mcp-config",
    mcpConfigPath,
    "--allowed-tools",
    ALLOWED_TOOLS,
    "--permission-mode",
    "acceptEdits",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(maxTurnsFor(kind)),
    "--model",
    modelFor(kind),
  ];
}

async function writeMcpConfig(): Promise<string> {
  const config = {
    mcpServers: {
      github: {
        command: MCP_SERVER_BINARY,
        args: ["stdio"],
      },
    },
  };
  const filePath = path.join(
    MCP_CONFIG_DIR,
    `pr-agent-mcp-${crypto.randomUUID()}.json`,
  );
  await Bun.write(filePath, JSON.stringify(config));
  return filePath;
}

function modelFor(kind: Kind): string {
  return kind === "review" ? REVIEW_MODEL : SUMMARY_MODEL;
}

function maxTurnsFor(kind: Kind): number {
  return kind === "review" ? REVIEW_MAX_TURNS : SUMMARY_MAX_TURNS;
}

function buildPrompt(input: PrAgentInput): string {
  return input.kind === "review"
    ? buildReviewPrompt(input)
    : buildSummaryPrompt(input);
}

export type PrAgentResult = {
  kind: Kind;
  exitCode: number;
  resultText: string;
  durationMs: number;
};

async function runClaude(input: PrAgentInput): Promise<PrAgentResult> {
  const githubToken = Bun.env["GITHUB_PERSONAL_ACCESS_TOKEN"];
  const claudeToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (githubToken === undefined || githubToken === "") {
    throw new Error("GITHUB_PERSONAL_ACCESS_TOKEN is required");
  }
  if (claudeToken === undefined || claudeToken === "") {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required");
  }

  const mcpConfigPath = await writeMcpConfig();
  const prompt = buildPrompt(input);
  const model = modelFor(input.kind);

  const args = buildClaudeArgs({
    prompt,
    mcpConfigPath,
    kind: input.kind,
  });

  jsonLog("info", "Invoking claude -p for PR agent", {
    kind: input.kind,
    model,
    prNumber: input.prNumber,
    commitSha: input.commitSha,
  });

  const startMs = Date.now();
  const proc = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
      CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
    },
  });

  const heartbeat = setInterval(() => {
    Context.current().heartbeat({
      kind: input.kind,
      prNumber: input.prNumber,
      elapsedMs: Date.now() - startMs,
    });
  }, HEARTBEAT_INTERVAL_MS);

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
          const redacted = redactToken(
            redactToken(line, githubToken),
            claudeToken,
          );
          jsonLog("info", "claude stderr", {
            line: redacted,
            kind: input.kind,
          });
        }
      }
      if (buf.length > 0) {
        const redacted = redactToken(
          redactToken(buf, githubToken),
          claudeToken,
        );
        jsonLog("info", "claude stderr", { line: redacted, kind: input.kind });
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
    try {
      await Bun.file(mcpConfigPath).delete();
    } catch (cleanupError: unknown) {
      jsonLog("warning", "Failed to delete MCP config tempfile", {
        path: mcpConfigPath,
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
  }

  const durationMs = Date.now() - startMs;
  const durationSeconds = durationMs / 1000;

  prAgentSubprocessDurationSeconds.observe(
    { kind: input.kind, model, exit_code: String(exitCode) },
    durationSeconds,
  );
  prAgentSubprocessExitTotal.inc({
    kind: input.kind,
    exit_code: String(exitCode),
  });

  if (exitCode !== 0) {
    const e = new Error(
      `claude -p exited with code ${String(exitCode)} (kind=${input.kind})`,
    );
    captureWithContext(e, input.kind, { exitCode, durationMs });
    throw e;
  }

  let resultMsg;
  try {
    resultMsg = parseClaudeResultMessage(stdout);
  } catch (error: unknown) {
    captureWithContext(error, input.kind, {
      stdoutHead: stdout.slice(0, 500),
    });
    throw new Error(
      `Failed to parse claude --output-format json result: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (resultMsg.is_error === true) {
    const e = new Error(
      `claude -p reported is_error=true: ${resultMsg.result ?? "(no result text)"}`,
    );
    captureWithContext(e, input.kind);
    throw e;
  }

  const usage = resultMsg.usage;
  if (usage !== undefined) {
    if (usage.input_tokens !== undefined) {
      prAgentTokensTotal.inc(
        { kind: input.kind, model, direction: "input" },
        usage.input_tokens,
      );
    }
    if (usage.output_tokens !== undefined) {
      prAgentTokensTotal.inc(
        { kind: input.kind, model, direction: "output" },
        usage.output_tokens,
      );
    }
    if (usage.cache_creation_input_tokens !== undefined) {
      prAgentTokensTotal.inc(
        { kind: input.kind, model, direction: "cache_create" },
        usage.cache_creation_input_tokens,
      );
    }
    if (usage.cache_read_input_tokens !== undefined) {
      prAgentTokensTotal.inc(
        { kind: input.kind, model, direction: "cache_read" },
        usage.cache_read_input_tokens,
      );
    }
  }

  jsonLog("info", "claude -p completed", {
    kind: input.kind,
    durationMs,
    exitCode,
    costUsd: resultMsg.total_cost_usd,
    numTurns: resultMsg.num_turns,
  });

  return {
    kind: input.kind,
    exitCode,
    resultText: resultMsg.result ?? "",
    durationMs,
  };
}

export type PrAgentActivities = typeof prAgentActivities;

export const prAgentActivities = {
  async runPrAgent(input: PrAgentInput): Promise<PrAgentResult> {
    return runClaude(input);
  },
};
