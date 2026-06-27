/**
 * `runBabysitIteration` — one mutating agent pass. Reuses the shared
 * tracked-subprocess machinery (`runTrackedAgentSubprocess`: heartbeats,
 * soft-kill, redaction, cancellation) and the claude result parser. The agent
 * edits + commits in the workdir but does NOT push; the orchestrator pushes
 * after this returns (so the push always uses a fresh token).
 *
 * The `Context.current()` calls in the shared helper are all guarded for
 * "outside Temporal", so this runs unchanged from the local PoC script and
 * (later) from a Temporal activity.
 */
import * as Sentry from "@sentry/bun";
import { runTrackedAgentSubprocess } from "#shared/agent-subprocess.ts";
import {
  parseClaudeResultMessage,
  summarizeClaudeStreamLine,
} from "#shared/claude-result.ts";
import { redactSecrets } from "#shared/redact.ts";
import { babysitIterationPrompt } from "#shared/pr-babysit/prompt.ts";
import {
  BabysitIterationResultSchema,
  type BabysitIterationCost,
  type BabysitIterationResult,
  type BabysitVerdict,
  type PrBabysitInput,
} from "#shared/pr-babysit/types.ts";
import { buildBabysitIterationCommand } from "./iteration-command.ts";

const COMPONENT = "pr-babysit";
const HEARTBEAT_INTERVAL_MS = 10_000;

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

export type RunBabysitIterationInput = {
  input: PrBabysitInput;
  verdict: BabysitVerdict;
  workdir: string;
  /** Steering text from a human guidance reply, if any. */
  guidance?: string;
  /** Extra env for the subprocess (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, ...). */
  env?: Record<string, string>;
  /** Activity start-to-close (ms); enables the pre-timeout soft-kill. */
  startToCloseTimeoutMs?: number;
  /** Temporal cancellation signal; omit for the local PoC. */
  cancellationSignal?: AbortSignal;
};

export type RunBabysitIterationResult = {
  result: BabysitIterationResult;
  cost: BabysitIterationCost;
};

function secretTokens(): readonly (string | undefined)[] {
  return [
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"],
    Bun.env["ANTHROPIC_API_KEY"],
    Bun.env["GH_TOKEN"],
    Bun.env["GITHUB_APP_PRIVATE_KEY"],
    Bun.env["GITHUB_PERSONAL_ACCESS_TOKEN"],
  ];
}

export async function runBabysitIteration(
  args: RunBabysitIterationInput,
): Promise<RunBabysitIterationResult> {
  // The `claude` CLI accepts either the subscription OAuth token or a direct
  // API key; require at least one so the agent can authenticate.
  const hasClaudeAuth =
    (Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "") !== "" ||
    (Bun.env["ANTHROPIC_API_KEY"] ?? "") !== "";
  if (!hasClaudeAuth) {
    throw new Error(
      "claude auth required: set CLAUDE_CODE_OAUTH_TOKEN (subscription) or ANTHROPIC_API_KEY",
    );
  }

  const prompt = babysitIterationPrompt({
    owner: args.input.owner,
    repo: args.input.repo,
    prNumber: args.input.prNumber,
    headRef: args.input.headRef,
    baseRef: args.input.baseRef,
    workdir: args.workdir,
    goal: args.input.goal,
    guidance: args.guidance,
    verdict: args.verdict,
  });
  const command = buildBabysitIterationCommand({
    prompt,
    workdir: args.workdir,
    model: args.input.model,
    maxTurns: args.input.budget.perIterationMaxTurns,
  });

  jsonLog("info", "Starting babysit iteration", {
    phase: "spawn",
    prNumber: args.input.prNumber,
    model: args.input.model,
    maxTurns: args.input.budget.perIterationMaxTurns,
    workdir: args.workdir,
  });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  Object.assign(env, args.env ?? {});
  const result = await runTrackedAgentSubprocess(
    {
      command,
      cwd: args.workdir,
      env,
      redactTokens: secretTokens(),
      startToCloseTimeoutMs: args.startToCloseTimeoutMs,
      cancellationSignal: args.cancellationSignal,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      onHeartbeat: (beat) => {
        jsonLog("info", "babysit heartbeat", { phase: "agent", ...beat });
      },
      onSoftKill: (event) => {
        jsonLog("warning", "babysit soft-kill", {
          phase: "soft-kill",
          ...event,
        });
      },
      onSigkillEscalation: (event) => {
        jsonLog("warning", "babysit sigkill escalation", {
          phase: "sigkill",
          ...event,
        });
      },
      onStdoutLine: (line) => {
        const event = summarizeClaudeStreamLine(line);
        if (event !== undefined) {
          jsonLog("info", "babysit agent event", {
            phase: "agent-event",
            ...event,
          });
        }
      },
      onStderrLine: (line) => {
        jsonLog("info", "babysit agent stderr", { line });
      },
      onCancellation: (state) => {
        jsonLog(
          "warning",
          "babysit iteration cancelled; killing subprocess",
          state,
        );
      },
    },
    redactSecrets,
  );

  if (result.signal === "SIGTERM") {
    const error = new Error("babysit iteration cancelled");
    Sentry.captureException(error);
    throw error;
  }
  if (result.exitCode !== 0) {
    const error = new Error(
      `babysit iteration exited with code ${String(result.exitCode)} (signal=${result.signal})`,
    );
    Sentry.captureException(error);
    throw error;
  }

  const message = parseClaudeResultMessage(result.stdout);
  const parsed = BabysitIterationResultSchema.safeParse(
    message.structured_output,
  );
  if (!parsed.success) {
    const error = new Error(
      `babysit iteration produced invalid structured output: ${parsed.error.message}`,
    );
    Sentry.captureException(error);
    throw error;
  }

  jsonLog("info", "Babysit iteration complete", {
    phase: "exited",
    committed: parsed.data.committed,
    changedPaths: parsed.data.changedPaths,
    needsGuidance: parsed.data.needsGuidance,
    intentConflict: parsed.data.intentConflict,
    costUsd: message.total_cost_usd,
    numTurns: message.num_turns,
    durationMs: result.durationMs,
  });

  return {
    result: parsed.data,
    cost: {
      costUsd: message.total_cost_usd,
      numTurns: message.num_turns,
      durationMs: result.durationMs,
    },
  };
}
