import path from "node:path";
import { logger } from "#src/logger.ts";
import type { Config } from "#src/config/schema.ts";
import { hasCodexCredential } from "./codex-auth.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";
import type { SpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import type { CodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import type { CodexTrace } from "./codex-trace.ts";
import { sanitizeDiscordText, truncateForDiscord } from "./discord-message.ts";
import { formatGameStateForPrompt } from "./game-state-summary.ts";
import { GoalIntervalReporter } from "./goal-progress.ts";
import { formatHistoryForPrompt } from "./history-summary.ts";
import { computeCost, formatCostLine } from "./pricing.ts";
import { spawnGoalCodex } from "./spawn-goal-codex.ts";

import { appendToHistory, type CompletedGoal } from "./goal-history.ts";
import type {
  GoalMessageSender,
  GoalProcess,
  GoalProcessSpawner,
  GoalState,
  StartGoalInput,
  StartGoalResult,
} from "./goal-types.ts";
import { GoalMemory, buildSessionLogMeta } from "./goal-memory.ts";
import { GoalControlGate } from "./goal-control-gate.ts";
import {
  recordGoalFinished,
  recordGoalStarted,
  recordGoalUsage,
} from "./goal-metrics.ts";
import { loadGoalHistory, persistGoalState } from "./goal-state-store.ts";

type ActiveGoal = {
  state: GoalState;
  process: GoalProcess;
  timeout: ReturnType<typeof setTimeout>;
  lastProgressSentAt: number;
  outputPath: string;
  jsonl: CodexJsonlParser;
  stdoutPump: Promise<void>;
  trace: CodexTrace;
  releaseInputLease: () => void;
  // Interval updates + milestone forwarding (see goal-progress.ts).
  reporter: GoalIntervalReporter;
  updateTimer: ReturnType<typeof setInterval>;
};

type GoalManagerOptions = {
  config: Config["game"]["goal"];
  controlToken: string;
  sendMessage: GoalMessageSender;
  spawner?: GoalProcessSpawner;
  now?: () => Date;
  // Live snapshot readers called once at goal start to seed the prompt's
  // game-state + spatial blocks. Model refreshes via `pokemonctl state`,
  // which reads through the same path on the control-server side. Optional
  // so tests that don't exercise prompt context don't have to pass a stub.
  snapshotProvider?: () => GameSnapshot | null;
  spatialSnapshotProvider?: () => SpatialSnapshot | null;
  acquireInputLease?: () => () => void;
  // Commit live game progress to the flash save when a goal ends; the driver
  // wires this to `emulator.checkpointSave()`. Optional so tests that don't
  // exercise persistence don't have to pass a stub. See goal-checkpoint.ts.
  checkpointGame?: () => Promise<void>;
  // Overrides the end-of-goal checkpoint retry policy; tests use it to retry
  // without real delays.
  checkpointRetry?: CheckpointRetry;
};

import { defaultSpawner, settleGoalProcess } from "./goal-process-helpers.ts";
import { noOpAcquireInputLease, oneShot } from "./goal-lease-helpers.ts";
import { defaultCheckpointRetry, saveOnGoalEnd } from "./goal-checkpoint.ts";
import type { CheckpointRetry } from "./goal-checkpoint.ts";

export class GoalManager {
  private active: ActiveGoal | undefined;
  private terminating: ActiveGoal | undefined;
  private startPromise: Promise<StartGoalResult> | undefined;
  private shuttingDown = false;
  private readonly config: Config["game"]["goal"];
  private readonly controlToken: string;
  private readonly sendMessage: GoalMessageSender;
  private readonly spawner: GoalProcessSpawner;
  private readonly now: () => Date;
  private readonly snapshotProvider: () => GameSnapshot | null;
  private readonly spatialSnapshotProvider: () => SpatialSnapshot | null;
  private readonly acquireInputLease: () => () => void;
  private readonly checkpointGame: () => Promise<void>;
  private readonly checkpointRetry: CheckpointRetry;
  private readonly controlGate = new GoalControlGate();
  // Per-guild persistent memory: the curated MEMORY.md fed into every prompt,
  // system-written session logs, and MEMORY.md archives. Backed by
  // config.memory_dir (the driver points it under saves/<guildId>/). Exposed to
  // the control server for the `pokemonctl list/read/grep/write` subcommands.
  readonly memory: GoalMemory;
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
    this.spatialSnapshotProvider =
      options.spatialSnapshotProvider ?? (() => null);
    this.acquireInputLease = options.acquireInputLease ?? noOpAcquireInputLease;
    this.checkpointGame = options.checkpointGame ?? (() => Promise.resolve());
    this.checkpointRetry = options.checkpointRetry ?? defaultCheckpointRetry;
    this.memory = new GoalMemory(
      this.resolveRuntimePath(this.config.memory_dir),
      this.now,
    );
  }

  /**
   * Seed in-memory history from the persisted state file so goal history
   * survives server restarts. Call once after constructing GoalManager,
   * before the first startGoal(). No-ops silently if the file is absent or
   * has an unexpected shape — the in-memory list simply starts empty.
   */
  async initialize(): Promise<void> {
    const statePath = this.resolveRuntimePath(this.config.state_path);
    const loaded = await loadGoalHistory(statePath);
    this.history = loaded;
    for (const entry of loaded) this.recordedIds.add(entry.id);
    logger.info(
      `goal-manager: loaded ${String(loaded.length)} history entries from disk`,
    );
  }

  getStatus(): GoalState | undefined {
    return this.active?.state ?? this.terminating?.state;
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

  beginControlRequest(token: string, goalId: string): (() => void) | undefined {
    if (token !== this.controlToken) return undefined;
    return this.controlGate.begin(goalId);
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

    if (this.shuttingDown) {
      return {
        kind: "disabled",
        content: "The active Pokémon session is shutting down.",
        ephemeral: true,
      };
    }
    if (this.startPromise !== undefined || this.terminating !== undefined) {
      return {
        kind: "busy",
        content: "Another goal is already starting. Try again in a moment.",
        ephemeral: true,
      };
    }
    const startPromise = this.startGoalLocked(input, goal);
    this.startPromise = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
      }
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
    // Snapshot + recent goals seed the prompt; model refreshes via pokemonctl.
    const gameStateSummary = formatGameStateForPrompt(
      this.snapshotProvider(),
      this.spatialSnapshotProvider(),
    );
    const memory = await this.memory.readMemory();
    const releaseInputLease = oneShot(this.acquireInputLease());
    this.controlGate.open(id);
    // Subscribed at spawn (before the stdout pump) so no early agent_message
    // is lost; reporter.activate below starts posting once the goal is active.
    const reporter = new GoalIntervalReporter({
      updateIntervalSeconds: this.config.update_interval_seconds,
      progressUpdateIntervalSeconds:
        this.config.progress_update_interval_seconds,
      sendMessage: this.sendMessage,
      now: () => this.now().getTime(),
      spatialSnapshot: this.spatialSnapshotProvider,
    });
    let spawned: Awaited<ReturnType<typeof spawnGoalCodex>>;
    try {
      spawned = await spawnGoalCodex({
        config: this.config,
        controlToken: this.controlToken,
        goalId: id,
        goal,
        requestedBy: input.requesterId,
        promptContext: {
          gameStateSummary,
          recentGoalsSummary: formatHistoryForPrompt(this.getHistory(3)),
          memory,
        },
        spawner: this.spawner,
        onAgentMessage: reporter.onAgentMessage,
      });
    } catch (error) {
      this.controlGate.close(id);
      await this.controlGate.drain();
      releaseInputLease();
      throw error;
    }

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
    try {
      await this.persistState(state);
    } catch (error) {
      this.controlGate.close(id);
      try {
        await settleGoalProcess(
          {
            process: spawned.process,
            stdoutPump: spawned.stdoutPump,
          },
          true,
          () => this.controlGate.drain(),
        );
      } finally {
        releaseInputLease();
        spawned.trace.end();
      }
      throw error;
    }
    const timeout = setTimeout(() => {
      void this.timeoutGoal(id);
    }, this.config.max_runtime_minutes * 60_000);
    const updateTimer = setInterval(() => {
      const current = this.active;
      if (current?.state.id !== id) return;
      void current.reporter.tick(current);
    }, this.config.update_interval_seconds * 1000);
    this.active = {
      state,
      process: spawned.process,
      timeout,
      lastProgressSentAt: 0,
      outputPath: spawned.outputPath,
      jsonl: spawned.jsonl,
      stdoutPump: spawned.stdoutPump,
      trace: spawned.trace,
      releaseInputLease,
      reporter,
      updateTimer,
    };
    reporter.activate((text) => void this.forwardMilestone(id, text));
    recordGoalStarted();
    void this.observeProcess(id);

    return {
      kind: "started",
      content: `Goal started: ${sanitizeDiscordText(goal)}`,
      ephemeral: false,
    };
  }

  async publishProgress(
    message: string,
    source: "agent" | "milestone" = "agent",
  ): Promise<boolean> {
    const active = this.active;
    if (active === undefined) return false;
    return active.reporter.publishProgress(active, message, source, () =>
      this.persistState(active.state),
    );
  }

  /**
   * Record one control-server tool call into the active goal's activity log.
   * No-op when the goal id doesn't match the active goal (late calls from a
   * replaced/finished goal).
   */
  recordToolCall(
    goalId: string,
    entry: Readonly<{ method: string; path: string; status: number }>,
  ): void {
    if (this.active?.state.id !== goalId) return;
    this.active.reporter.recordToolCall(entry);
  }

  private async forwardMilestone(id: string, text: string): Promise<void> {
    if (this.active?.state.id !== id) return;
    try {
      await this.publishProgress(text, "milestone");
    } catch (error) {
      logger.warn(`goal milestone forward failed: ${String(error)}`);
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const startPromise = this.startPromise;
    if (startPromise !== undefined) {
      await Promise.allSettled([startPromise]);
    }
    await this.stopActive("shutdown");
  }

  private saveCheckpoint(status: string): Promise<void> {
    return saveOnGoalEnd(this.checkpointGame, status, this.checkpointRetry);
  }

  private async observeProcess(id: string): Promise<void> {
    const active = this.active;
    if (active?.state.id !== id) {
      return;
    }

    await active.process.exited;
    const claimed = this.claimActive(id);
    if (claimed === undefined) return;
    try {
      const exitCode = await settleGoalProcess(claimed, false, () =>
        this.controlGate.drain(),
      );
      const report = await this.readFinalReport(claimed.outputPath);
      claimed.state.finishedAt = this.now().toISOString();
      claimed.state.exitCode = exitCode;
      claimed.state.status = exitCode === 0 ? "completed" : "failed";
      claimed.state.finalReport = report;
      recordGoalFinished(claimed.state);
      await this.recordCompletion(claimed.state);
      await this.persistState(claimed.state);
      await this.saveCheckpoint(claimed.state.status);
      const usage = claimed.jsonl.total();
      const cost = computeCost(this.config.model, usage);
      recordGoalUsage(usage, cost);
      const costLine = formatCostLine(this.config.model, cost, usage);
      await this.sendMessage({
        channelId: claimed.state.channelId,
        content: truncateForDiscord(
          `<@${claimed.state.requestedBy}> goal ${
            exitCode === 0 ? "finished" : "stopped with an error"
          } (${costLine}): ${sanitizeDiscordText(report)}`,
        ),
        allowedUserIds: [claimed.state.requestedBy],
      });
    } finally {
      claimed.releaseInputLease();
      claimed.trace.end();
      if (this.terminating === claimed) this.terminating = undefined;
    }
  }

  private async timeoutGoal(id: string): Promise<void> {
    const active = this.claimActive(id);
    if (active === undefined) return;
    try {
      await settleGoalProcess(active, true, () => this.controlGate.drain());
      const usage = active.jsonl.total();
      recordGoalUsage(usage, computeCost(this.config.model, usage));
      active.state.status = "timeout";
      active.state.finishedAt = this.now().toISOString();
      active.state.finalReport = "Goal timed out before Codex finished.";
      recordGoalFinished(active.state);
      await this.recordCompletion(active.state);
      await this.persistState(active.state);
      await this.saveCheckpoint("timeout");
      await this.sendMessage({
        channelId: active.state.channelId,
        content: `<@${active.state.requestedBy}> goal timed out after ${String(
          this.config.max_runtime_minutes,
        )} minutes.`,
        allowedUserIds: [active.state.requestedBy],
      });
    } finally {
      active.releaseInputLease();
      active.trace.end();
      if (this.terminating === active) this.terminating = undefined;
    }
  }

  private async stopActive(status: "replaced" | "shutdown"): Promise<void> {
    const active = this.claimActive();
    if (active === undefined) {
      return;
    }
    try {
      await settleGoalProcess(active, true, () => this.controlGate.drain());
      const usage = active.jsonl.total();
      recordGoalUsage(usage, computeCost(this.config.model, usage));
      active.state.status = status;
      active.state.finishedAt = this.now().toISOString();
      active.state.finalReport =
        status === "replaced"
          ? "Goal was replaced by a newer goal."
          : "Goal was stopped during application shutdown.";
      recordGoalFinished(active.state);
      await this.recordCompletion(active.state);
      await this.persistState(active.state);
      // On "shutdown" the driver's onSessionStop checkpoints once for the whole
      // session, so only the "replaced" path saves here to avoid a double save.
      if (status === "replaced") {
        await this.saveCheckpoint("replaced");
      }
    } finally {
      active.releaseInputLease();
      active.trace.end();
      if (this.terminating === active) this.terminating = undefined;
    }
  }

  private claimActive(id?: string): ActiveGoal | undefined {
    const active = this.active;
    if (active === undefined || (id !== undefined && active.state.id !== id)) {
      return undefined;
    }
    // Claim synchronously before any terminal-path await. SIGTERM resolves the
    // process exit promise, so stop/timeout and observeProcess can otherwise
    // race through teardown and release the same lease twice.
    this.active = undefined;
    this.terminating = active;
    this.controlGate.close(active.state.id);
    clearTimeout(active.timeout);
    // All four terminal paths land here: stop the interval updater
    // (milestone forwarding no-ops itself once this.active clears).
    clearInterval(active.updateTimer);
    return active;
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
    await persistGoalState({
      statePath: this.resolveRuntimePath(this.config.state_path),
      state,
      history: this.history,
    });
  }

  /**
   * Snapshot a finished goal into the rolling history list (trimmed to
   * HISTORY_LIMIT) and write its session log to the memory PVC. Called from
   * every terminal path (observeProcess, timeoutGoal, stopActive) so all of
   * {completed, failed, timeout, replaced, shutdown} leave a browsable log.
   * A memory-write failure is logged, never thrown — teardown must not fail.
   */
  private async recordCompletion(state: GoalState): Promise<void> {
    this.history = [...appendToHistory(this.history, this.recordedIds, state)];
    try {
      await this.memory.writeSessionLog(
        buildSessionLogMeta(state),
        state.finalReport ?? "(no final report)",
      );
    } catch (error) {
      logger.warn(
        `goal-manager: failed to write session log: ${String(error)}`,
      );
    }
  }
}
