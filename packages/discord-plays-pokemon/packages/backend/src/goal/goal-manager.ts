import path from "node:path";
import { logger } from "#src/logger.ts";
import type { Config } from "#src/config/schema.ts";
import { hasCodexCredential } from "./codex-auth.ts";
import { prepareRuntimeTools, buildEnvironment } from "./goal-runtime-env.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";
import { buildCodexArgs } from "./codex-command.ts";
import {
  createCodexJsonlParser,
  pumpCodexStdout,
  type CodexJsonlParser,
} from "./codex-jsonl.ts";
import { attachCodexTrace, type CodexTrace } from "./codex-trace.ts";
import { sanitizeDiscordText, truncateForDiscord } from "./discord-message.ts";
import { formatGameStateForPrompt } from "./game-state-summary.ts";
import { formatHistoryForPrompt } from "./history-summary.ts";
import { computeCost, formatCostLine } from "./pricing.ts";

import { appendToHistory, type CompletedGoal } from "./goal-history.ts";
import type { GoalState } from "./goal-types.ts";

type ActiveGoal = {
  state: GoalState;
  process: GoalProcess;
  timeout: ReturnType<typeof setTimeout>;
  lastProgressSentAt: number;
  outputPath: string;
  // Streaming parser for Codex's `--json` stdout. Accumulates token usage so
  // observeProcess() can build a cost line for the final Discord message.
  jsonl: CodexJsonlParser;
  // OTel span synthesis attached to the parser. The archive SpanProcessor
  // (observability/tracing.ts) ships full request/response bodies to S3.
  trace: CodexTrace;
};

export type GoalProcess = {
  pid?: number;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals | number) => void;
};

export type GoalProcessSpawner = (
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
  },
) => GoalProcess;

export type GoalDiscordMessage = {
  channelId: string;
  content: string;
  allowedUserIds?: string[];
};

export type GoalMessageSender = (message: GoalDiscordMessage) => Promise<void>;

export type StartGoalInput = {
  goal: string;
  requesterId: string;
  channelId: string;
};

export type StartGoalResult =
  | {
      kind: "started";
      content: string;
      ephemeral: false;
    }
  | {
      kind: "locked" | "disabled" | "invalid" | "missing_credential" | "busy";
      content: string;
      ephemeral: true;
    };

type GoalManagerOptions = {
  config: Config["game"]["goal"];
  controlToken: string;
  sendMessage: GoalMessageSender;
  spawner?: GoalProcessSpawner;
  now?: () => Date;
  // Live snapshot reader. Called once at goal start to seed the prompt's
  // "Current game state" block. The model can refresh at any time via
  // `pokemonctl state` (T5), which reads through the same path on the
  // control-server side. Returning null is fine (renders "unavailable").
  // Optional so existing tests that don't exercise prompt context don't have
  // to pass a stub.
  snapshotProvider?: () => GameSnapshot | null;
};

function defaultSpawner(
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
  },
): GoalProcess {
  return Bun.spawn(args, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function streamToLog(
  stream: ReadableStream<Uint8Array> | null,
  label: string,
): Promise<void> {
  if (stream === null) {
    return;
  }

  const text = await new Response(stream).text();
  const trimmed = text.trim();
  if (trimmed.length > 0) {
    logger.info(`goal codex ${label}: ${trimmed}`);
  }
}

export class GoalManager {
  private active: ActiveGoal | undefined;
  // Synchronously claimed at the top of startGoal before its first await, so two
  // near-simultaneous /goal interactions cannot both pass the lock check and
  // both spawn a Codex process (orphaning the first). JS is single-threaded, so
  // the check-and-set below the lock check fully closes the window.
  private starting = false;
  private readonly config: Config["game"]["goal"];
  private readonly controlToken: string;
  private readonly sendMessage: GoalMessageSender;
  private readonly spawner: GoalProcessSpawner;
  private readonly now: () => Date;
  private readonly snapshotProvider: () => GameSnapshot | null;
  // Newest first. Persisted via persistState() so it survives restarts.
  private history: CompletedGoal[] = [];
  // Goal IDs we've already snapshot into history. Guards against double-record
  // when stopActive() kills a process and its observeProcess() later resumes.
  // Trimmed lazily inside recordCompletion when it grows past 2× HISTORY_LIMIT.
  private readonly recordedIds = new Set<string>();

  constructor(options: GoalManagerOptions) {
    this.config = options.config;
    this.controlToken = options.controlToken;
    this.sendMessage = options.sendMessage;
    this.spawner = options.spawner ?? defaultSpawner;
    this.now = options.now ?? (() => new Date());
    this.snapshotProvider = options.snapshotProvider ?? (() => null);
  }

  getStatus(): GoalState | undefined {
    return this.active?.state;
  }

  /**
   * Most-recent `limit` finished goals, newest first. Surfaced to the model via
   * the new `pokemonctl history` subcommand (T5). Use `limit <= HISTORY_LIMIT`
   * for accuracy; we never persist more than that.
   */
  getHistory(limit: number): CompletedGoal[] {
    if (limit <= 0) return [];
    return this.history.slice(0, limit);
  }

  async startGoal(input: StartGoalInput): Promise<StartGoalResult> {
    if (!this.config.enabled) {
      return {
        kind: "disabled",
        content: "Goal mode is not enabled for this Pokemon instance.",
        ephemeral: true,
      };
    }

    const goal = input.goal.trim();
    if (goal.length === 0) {
      return {
        kind: "invalid",
        content: "Goal cannot be empty.",
        ephemeral: true,
      };
    }

    // Claim the start slot synchronously, before the first await, so a second
    // concurrent /goal cannot also reach the spawn path and orphan a process.
    if (this.starting) {
      return {
        kind: "busy",
        content: "Another goal is already starting. Try again in a moment.",
        ephemeral: true,
      };
    }
    this.starting = true;
    try {
      return await this.startGoalLocked(input, goal);
    } finally {
      this.starting = false;
    }
  }

  private async startGoalLocked(
    input: StartGoalInput,
    goal: string,
  ): Promise<StartGoalResult> {
    if (!(await hasCodexCredential(this.config.runtime_directory))) {
      return {
        kind: "missing_credential",
        content:
          "Goal mode requires CODEX_API_KEY, CODEX_ACCESS_TOKEN, OPENAI_API_KEY, or a mounted Codex auth cache in the Pokemon runtime.",
        ephemeral: true,
      };
    }

    const now = this.now();
    const active = this.active;
    if (
      active !== undefined &&
      active.state.requestedBy !== input.requesterId &&
      now < new Date(active.state.lockedUntil)
    ) {
      return {
        kind: "locked",
        content: `A goal is already locked until ${active.state.lockedUntil}.`,
        ephemeral: true,
      };
    }

    if (active !== undefined) {
      await this.stopActive("replaced");
    }

    const id = crypto.randomUUID();
    const startedAt = now.toISOString();
    const lockedUntil = new Date(
      now.getTime() + this.config.lock_minutes * 60_000,
    ).toISOString();
    const deadline = new Date(
      now.getTime() + this.config.max_runtime_minutes * 60_000,
    ).toISOString();
    const runtimeDirectory = path.resolve(this.config.runtime_directory);
    const screenshotDirectory = this.resolveRuntimePath(
      this.config.screenshot_dir,
    );
    await Bun.write(path.join(screenshotDirectory, ".keep"), "", {
      createPath: true,
    });
    const helperDirectory = await prepareRuntimeTools(runtimeDirectory);
    const outputPath = path.join(screenshotDirectory, `${id}-final.txt`);
    // Snapshot + 3 most-recent goals as the static prompt context. The model
    // can refresh both at any time via `pokemonctl state` / `pokemonctl history`.
    const gameStateSummary = formatGameStateForPrompt(this.snapshotProvider());
    const promptContext = {
      gameStateSummary,
      recentGoalsSummary: formatHistoryForPrompt(this.getHistory(3)),
    };
    const args = buildCodexArgs({
      config: {
        codexBinary: this.config.codex_binary,
        model: this.config.model,
      },
      goal,
      runtimeDirectory,
      outputPath,
      context: promptContext,
    });

    const process = this.spawner(args, {
      cwd: runtimeDirectory,
      env: buildEnvironment({
        runtimeDirectory,
        helperDirectory,
        controlHost: this.config.control_host,
        controlPort: this.config.control_port,
        controlToken: this.controlToken,
      }),
    });
    const jsonl = createCodexJsonlParser();
    // Span synthesis: subscribe before stdout pumping starts so no events are
    // missed. End the trace from every terminal path below.
    const trace = attachCodexTrace(jsonl, {
      goalId: id,
      goal,
      model: this.config.model,
      requestedBy: input.requesterId,
      gameStateSummary,
      initialPrompt: `goal=${goal}\nstate=${gameStateSummary}`,
    });
    void pumpCodexStdout(process.stdout, jsonl);
    void streamToLog(process.stderr, "stderr");

    const state: GoalState = {
      id,
      goal,
      requestedBy: input.requesterId,
      channelId: input.channelId,
      startedAt,
      lockedUntil,
      deadline,
      status: "running",
    };
    const timeout = setTimeout(() => {
      void this.timeoutGoal(id);
    }, this.config.max_runtime_minutes * 60_000);

    this.active = {
      state,
      process,
      timeout,
      lastProgressSentAt: 0,
      outputPath,
      jsonl,
      trace,
    };
    await this.persistState(state);
    void this.observeProcess(id);

    return {
      kind: "started",
      content: `Goal started: ${sanitizeDiscordText(goal)}`,
      ephemeral: false,
    };
  }

  async publishProgress(message: string): Promise<boolean> {
    const active = this.active;
    if (active === undefined) {
      return false;
    }

    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return false;
    }

    const now = this.now().getTime();
    const minimumDelay = this.config.progress_update_interval_seconds * 1000;
    if (now - active.lastProgressSentAt < minimumDelay) {
      return false;
    }

    active.lastProgressSentAt = now;
    active.state.lastProgress = trimmed;
    await this.persistState(active.state);
    await this.sendMessage({
      channelId: active.state.channelId,
      content: truncateForDiscord(
        `<@${active.state.requestedBy}> goal update: ${sanitizeDiscordText(trimmed)}`,
      ),
      allowedUserIds: [active.state.requestedBy],
    });
    return true;
  }

  async shutdown(): Promise<void> {
    await this.stopActive("shutdown");
  }

  private async observeProcess(id: string): Promise<void> {
    const active = this.active;
    if (active?.state.id !== id) {
      return;
    }

    const exitCode = await active.process.exited;
    if (this.active?.state.id !== id) {
      return;
    }

    clearTimeout(active.timeout);
    const report = await this.readFinalReport(active.outputPath);
    active.state.finishedAt = this.now().toISOString();
    active.state.exitCode = exitCode;
    active.state.status = exitCode === 0 ? "completed" : "failed";
    active.state.finalReport = report;
    this.recordCompletion(active.state);
    await this.persistState(active.state);
    active.trace.end();
    this.active = undefined;

    const usage = active.jsonl.total();
    const cost = computeCost(this.config.model, usage);
    const costLine = formatCostLine(this.config.model, cost, usage);

    await this.sendMessage({
      channelId: active.state.channelId,
      content: truncateForDiscord(
        `<@${active.state.requestedBy}> goal ${
          exitCode === 0 ? "finished" : "stopped with an error"
        }: ${sanitizeDiscordText(report)}\n${costLine}`,
      ),
      allowedUserIds: [active.state.requestedBy],
    });
  }

  private async timeoutGoal(id: string): Promise<void> {
    const active = this.active;
    if (active?.state.id !== id) {
      return;
    }

    active.process.kill("SIGTERM");
    active.state.status = "timeout";
    active.state.finishedAt = this.now().toISOString();
    active.state.finalReport = "Goal timed out before Codex finished.";
    this.recordCompletion(active.state);
    await this.persistState(active.state);
    active.trace.end();
    this.active = undefined;
    await this.sendMessage({
      channelId: active.state.channelId,
      content: `<@${active.state.requestedBy}> goal timed out after ${String(
        this.config.max_runtime_minutes,
      )} minutes.`,
      allowedUserIds: [active.state.requestedBy],
    });
  }

  private async stopActive(status: "replaced" | "shutdown"): Promise<void> {
    const active = this.active;
    if (active === undefined) {
      return;
    }

    clearTimeout(active.timeout);
    active.process.kill("SIGTERM");
    active.state.status = status;
    active.state.finishedAt = this.now().toISOString();
    active.state.finalReport =
      status === "replaced"
        ? "Goal was replaced by a newer goal."
        : "Goal was stopped during application shutdown.";
    this.recordCompletion(active.state);
    await this.persistState(active.state);
    active.trace.end();
    this.active = undefined;
  }

  private async readFinalReport(outputPath: string): Promise<string> {
    const file = Bun.file(outputPath);
    if (await file.exists()) {
      const rawText = await file.text();
      const text = rawText.trim();
      if (text.length > 0) {
        return text;
      }
    }
    return "Codex exited without writing a final report.";
  }

  private resolveRuntimePath(value: string): string {
    return path.isAbsolute(value)
      ? value
      : path.resolve(this.config.runtime_directory, value);
  }

  private async persistState(state: GoalState): Promise<void> {
    const statePath = this.resolveRuntimePath(this.config.state_path);
    const envelope = { current: state, history: this.history };
    await Bun.write(statePath, `${JSON.stringify(envelope, undefined, 2)}\n`, {
      createPath: true,
    });
  }

  /**
   * Snapshot a finished goal into the rolling history list and trim to
   * HISTORY_LIMIT. Called from every terminal path (observeProcess,
   * timeoutGoal, stopActive) so all of {completed, failed, timeout,
   * replaced, shutdown} leave a trace.
   */
  private recordCompletion(state: GoalState): void {
    this.history = [...appendToHistory(this.history, this.recordedIds, state)];
  }
}
