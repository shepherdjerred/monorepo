/**
 * `runBabysitIteration` — one mutating agent pass. Reuses the shared
 * tracked-subprocess machinery (`runTrackedAgentSubprocess`: heartbeats,
 * soft-kill, redaction, cancellation) and the claude result parser. The agent
 * edits + commits in the workdir but does NOT push; the orchestrator pushes
 * after this returns (so the push always uses a fresh token).
 *
 * The shared helper is a pure module (no Temporal imports); this caller threads
 * the Temporal heartbeat/cancellation via `safeHeartbeat` + the activity Context,
 * each guarded for "outside Temporal" so it runs unchanged from the local PoC
 * script and (in the worker) from a Temporal activity.
 */
import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { runTrackedAgentSubprocess } from "#shared/agent-subprocess.ts";
import {
  parseClaudeResultMessage,
  summarizeClaudeStreamLine,
} from "#shared/claude-result.ts";
import { redactSecrets } from "#shared/redact.ts";
import { traceClaudeCli } from "@shepherdjerred/llm-observability/wrappers/claude-cli";
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

/**
 * Subprocess heartbeat cadence. Overridable via env so tests can drive a fast
 * heartbeat without a 10s wait; defaults to 10s in prod.
 */
function heartbeatIntervalMs(): number {
  const raw = Bun.env["PR_BABYSIT_HEARTBEAT_INTERVAL_MS"];
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 10_000;
}

/**
 * Record a Temporal heartbeat. `Context.current()` throws when the activity is
 * invoked outside a Temporal worker (the local PoC script calls it as a plain
 * function), so the call is guarded — otherwise the activity's `heartbeatTimeout`
 * fires and Temporal kills every iteration.
 *
 * The guard suppresses ALL heartbeat failures, not only the outside-Temporal
 * case, but it logs them: a genuine failure inside a live activity (serialization,
 * payload-too-large) then leaves evidence instead of silently letting the
 * heartbeat timeout kill the run. Outside a Temporal activity this is a benign,
 * expected no-op (mirrors `alert-remediation.ts`).
 */
function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch (error: unknown) {
    jsonLog("info", "heartbeat skipped", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

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
  // Require the subscription OAuth token for the babysitter subprocess.
  // ANTHROPIC_API_KEY is deliberately never forwarded: it is a long-lived
  // deployment credential that injected PR or CI content could exfiltrate via
  // the subprocess's Bash + WebFetch tools. Fail closed rather than falling
  // back to the API key if the OAuth token is absent.
  const oauthToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (typeof oauthToken !== "string" || oauthToken === "") {
    throw new Error(
      "babysitter subprocess requires CLAUDE_CODE_OAUTH_TOKEN; ANTHROPIC_API_KEY is " +
        "not forwarded to the agent subprocess to limit credential exposure via prompt injection",
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

  // Build a minimal environment for the Claude subprocess. Passing the full
  // worker env would expose deployment secrets (GITHUB_APP_PRIVATE_KEY,
  // GITHUB_WEBHOOK_SECRET, POSTAL_API_KEY, etc.) to a prompt-injected process
  // that has Bash + WebFetch tools. Instead, forward only:
  //   1. Safe system vars (PATH, HOME, locale, tmp, terminal identity)
  //   2. CLAUDE_CODE_OAUTH_TOKEN only — already validated above. ANTHROPIC_API_KEY
  //      is never forwarded (see the guard above).
  //   3. Caller-scoped overrides (GH_TOKEN, GIT_ASKPASS, GIT_TERMINAL_PROMPT)
  const SYSTEM_ENV_ALLOWLIST: ReadonlySet<string> = new Set([
    "PATH",
    "HOME",
    "USER",
    "USERNAME",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TERM_PROGRAM",
    "COLORTERM",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
  ]);
  const env: Record<string, string> = {};
  for (const key of SYSTEM_ENV_ALLOWLIST) {
    const value = Bun.env[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  // oauthToken was validated above (throws if absent/empty).
  env["CLAUDE_CODE_OAUTH_TOKEN"] = oauthToken;
  // Caller provides GH_TOKEN, GIT_ASKPASS, GIT_TERMINAL_PROMPT.
  Object.assign(env, args.env ?? {});
  const llmStartMs = Date.now();
  const result = await runTrackedAgentSubprocess(
    {
      command,
      cwd: args.workdir,
      env,
      redactTokens: secretTokens(),
      startToCloseTimeoutMs: args.startToCloseTimeoutMs,
      cancellationSignal: args.cancellationSignal,
      heartbeatIntervalMs: heartbeatIntervalMs(),
      onHeartbeat: (beat) => {
        safeHeartbeat({ phase: "agent", ...beat });
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

  // Post-hoc gen_ai span for the whole run — before the failure checks so
  // cancelled/failed iterations are traced too (they still spent tokens).
  traceClaudeCli(
    {
      service: "temporal",
      callSite: "pr-babysit-iteration",
      request: {
        model: args.input.model,
        prompt,
        options: {
          prNumber: args.input.prNumber,
          maxTurns: args.input.budget.perIterationMaxTurns,
        },
      },
    },
    {
      stdout: result.stdout,
      exitCode: result.exitCode,
      startTimeMs: llmStartMs,
      endTimeMs: llmStartMs + result.durationMs,
    },
    {
      warn: (message) => {
        jsonLog("warning", message, { phase: "claude-cli-trace" });
      },
    },
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
