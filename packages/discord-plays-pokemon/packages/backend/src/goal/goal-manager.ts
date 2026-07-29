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
import { recordGoalFinished, recordGoalStarted } from "./goal-metrics.ts";
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
};

function oneShot(action: () => void): () => void {
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    action();
  };
}

function noOpRelease(): void {
  return;
}

function noOpAcquireInputLease(): () => void {
  return noOpRelease;
}

import { defaultSpawner } from "./goal-process-helpers.ts";

export class GoalManager {
  private active: ActiveGoal | undefined;
  private terminating: ActiveGoal | undefined;
  // Claimed before startGoal's first await to serialize concurrent requests.
  private starting = false;
  private readonly config: Config["game"]["goal"];
  private readonly controlToken: string;
  private readonly sendMessage: GoalMessageSender;
  private readonly spawner: GoalProcessSpawner;
  private readonly now: () => Date;
  private readonly snapshotProvider: () => GameSnapshot | null;
  private readonly spatialSnapshotProvider: () => SpatialSnapshot | null;
  private readonly acquireInputLease: () => () => void;
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

    // Claim the start slot synchronously, before the first await, so a second
    // concurrent /goal cannot also reach the spawn path and orphan a process.
    if (this.starting || this.terminating !== undefined) {
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
    // Snapshot + recent goals seed the prompt; model refreshes via pokemonctl.
    const gameStateSummary = formatGameStateForPrompt(
      this.snapshotProvider(),
      this.spatialSnapshotProvider(),
    );
    const memory = await this.memory.readMemory();
    const releaseInputLease = oneShot(this.acquireInputLease());
    this.controlGate.open(id);
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
    const timeout = setTimeout(() => {
      void this.timeoutGoal(id);
    }, this.config.max_runtime_minutes * 60_000);
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
    };
    try {
      await this.persistState(state);
    } catch (error) {
      clearTimeout(timeout);
      this.controlGate.close(id);
      spawned.process.kill("SIGTERM");
      await spawned.process.exited;
      await this.controlGate.drain();
      spawned.trace.end();
      releaseInputLease();
      this.active = undefined;
      throw error;
    }
    recordGoalStarted();
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
    // Mid-session updates are audience-facing narration for the livestream, not
    // a reply to the requester — post the message verbatim with no mention/prefix
    // so it reads naturally to viewers. (sanitizeDiscordText still defangs any @
    // the model emits; allowedUserIds is empty so nobody is pinged.)
    await this.sendMessage({
      channelId: active.state.channelId,
      content: truncateForDiscord(sanitizeDiscordText(trimmed)),
      allowedUserIds: [],
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
    const claimed = this.claimActive(id);
    if (claimed === undefined) return;
    try {
      await claimed.stdoutPump;
      await this.releaseGoalControls(claimed);
      const report = await this.readFinalReport(claimed.outputPath);
      claimed.state.finishedAt = this.now().toISOString();
      claimed.state.exitCode = exitCode;
      claimed.state.status = exitCode === 0 ? "completed" : "failed";
      claimed.state.finalReport = report;
      recordGoalFinished(claimed.state);
      await this.recordCompletion(claimed.state);
      await this.persistState(claimed.state);
      const usage = claimed.jsonl.total();
      const cost = computeCost(this.config.model, usage);
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
      active.process.kill("SIGTERM");
      await active.process.exited;
      await this.releaseGoalControls(active);
      active.state.status = "timeout";
      active.state.finishedAt = this.now().toISOString();
      active.state.finalReport = "Goal timed out before Codex finished.";
      recordGoalFinished(active.state);
      await this.recordCompletion(active.state);
      await this.persistState(active.state);
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
      active.process.kill("SIGTERM");
      await active.process.exited;
      await this.releaseGoalControls(active);
      active.state.status = status;
      active.state.finishedAt = this.now().toISOString();
      active.state.finalReport =
        status === "replaced"
          ? "Goal was replaced by a newer goal."
          : "Goal was stopped during application shutdown.";
      recordGoalFinished(active.state);
      await this.recordCompletion(active.state);
      await this.persistState(active.state);
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
    return active;
  }

  private async releaseGoalControls(active: ActiveGoal): Promise<void> {
    await this.controlGate.drain();
    active.releaseInputLease();
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
