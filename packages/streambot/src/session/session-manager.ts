import { createActor, type Actor } from "xstate";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/command-handler.ts";
import {
  StatusReporter,
  type StatusSnapshot,
} from "@shepherdjerred/streambot/discord/status-reporter.ts";
import {
  createPlaybackMachine,
  type PlaybackActors,
} from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type {
  PlaybackEvent,
  PlaybackInput,
  ResolvedSource,
  ResolveSourceInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import { buildPlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import {
  playbackPositionSeconds,
  queueLength,
  setPlaybackState,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import type {
  UserbotEntry,
  UserbotProvider,
} from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import {
  deleteState,
  listPersistedStateFiles,
  loadState,
  saveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  buildResumeAnnouncement,
  buildResumeInput,
  buildSnapshot,
  resumeKeyFor,
} from "@shepherdjerred/streambot/state/resume.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("session-manager");

/** How often to checkpoint a session's playback state to disk for resume. */
const CHECKPOINT_MS = 10 * 1000;
/** Once a resume has streamed healthily this long, mark it confirmed (reset the crash-loop counter). */
const RESUME_CONFIRM_MS = 30 * 1000;
/** Skip resuming an item that has crashed the bot this many consecutive boots (crash-loop guard). */
const MAX_RESUME_ATTEMPTS = 3;

type PlaybackActor = Actor<ReturnType<typeof createPlaybackMachine>>;

/** The slice of a session the command handler drives — bound to one guild + voice channel. */
export type SessionHandle = {
  dispatch: (event: PlaybackEvent) => void;
  view: () => PlaybackView;
  setVolume: (percent: number) => Promise<boolean>;
  seek: (seconds: number) => Promise<boolean>;
};

type Session = {
  readonly key: string;
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
  readonly statusChannelId: ChannelId | null;
  readonly entry: UserbotEntry;
  readonly actor: PlaybackActor;
  readonly reporter: StatusReporter;
  unsubscribe: () => void;
  /** True once the machine has left `idle` at least once, so we don't tear down on the boot snapshot. */
  hasStarted: boolean;
  // Per-session resume bookkeeping (mirrors the former single-instance loop in index.ts).
  persistResumeKey: string | null;
  persistResumeAttempts: number;
  resumeConfirmed: boolean;
  readonly bootAtMs: number;
  lastKnownPositionSeconds: number;
  checkpointTimer: ReturnType<typeof setInterval> | null;
  snapshotTail: Promise<void>;
  /** Set at teardown so a queued checkpoint can't re-write the file after we delete it. */
  torndown: boolean;
};

export type SessionManagerDeps = {
  readonly config: Config;
  readonly pool: UserbotProvider;
  /** Resolve a queued source to an ffmpeg input (injected so the machine stays pure + testable). */
  readonly resolveSource: (
    input: ResolveSourceInput,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  /** Post a world-readable message to a channel (no-op when the channel is null/unknown). */
  readonly announce: (
    channelId: ChannelId | null,
    message: string,
  ) => Promise<void>;
};

const IDLE_VIEW: PlaybackView = {
  state: "idle",
  current: null,
  queue: [],
  loop: "off",
  volume: 100,
};

/** A no-op handle for commands that target a guild/channel with no active session. */
export const EMPTY_HANDLE: SessionHandle = {
  dispatch: () => {
    /* no active session: ignore control events */
  },
  view: () => IDLE_VIEW,
  setVolume: () => Promise.resolve(false),
  seek: () => Promise.resolve(false),
};

function keyOf(guildId: GuildId, channelId: ChannelId): string {
  return `${guildId}:${channelId}`;
}

/**
 * Owns one playback session per `(guild, voice channel)`. A play command acquires a member-userbot
 * from the pool, spins up an isolated XState actor bound to that userbot's streamer, and tears it
 * down (releasing the userbot) when the channel goes idle. Concurrent sessions — across guilds or
 * across channels in one guild — are fully independent.
 */
export class SessionManager {
  private readonly deps: SessionManagerDeps;
  private readonly sessions = new Map<string, Session>();

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
  }

  /**
   * Ensure a session exists for `(guildId, voiceChannelId)` and return its handle. Returns the
   * existing session's handle if one is already running there (a second play just queues), or null
   * when no member-userbot is free.
   */
  ensureForPlay(params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    statusChannelId: ChannelId;
  }): SessionHandle | null {
    const existing = this.sessions.get(
      keyOf(params.guildId, params.voiceChannelId),
    );
    if (existing !== undefined) {
      return this.handleFor(existing);
    }
    const entry = this.deps.pool.acquire(params.guildId);
    if (entry === null) {
      return null;
    }
    const session = this.spawn({
      guildId: params.guildId,
      voiceChannelId: params.voiceChannelId,
      statusChannelId: params.statusChannelId,
      entry,
      input: {
        guildId: params.guildId,
        channelId: params.voiceChannelId,
        idleTimeoutMs: this.deps.config.idleTimeoutSeconds * 1000,
      },
      resumeKey: null,
      resumeAttempts: 0,
    });
    return this.handleFor(session);
  }

  /** Handle for an already-running session at `(guildId, channelId)`, or null if there is none. */
  getExisting(guildId: GuildId, channelId: ChannelId): SessionHandle | null {
    const session = this.sessions.get(keyOf(guildId, channelId));
    return session === undefined ? null : this.handleFor(session);
  }

  /** Metadata for the voice-state auto-stop check, or null when no session owns that channel. */
  activeSessionByChannel(
    guildId: GuildId,
    channelId: ChannelId,
  ): { voiceChannelId: ChannelId; userId: string | null } | null {
    const session = this.sessions.get(keyOf(guildId, channelId));
    if (session === undefined) {
      return null;
    }
    return {
      voiceChannelId: session.voiceChannelId,
      userId: session.entry.streamer.userId(),
    };
  }

  /**
   * Re-create sessions persisted before a restart. For each `(guild, channel)` state file: load it,
   * decide what to resume, acquire a member-userbot, and start the session — announcing once it's up.
   * Skips (and cleans up) files with nothing to resume, and logs when no userbot is free to take one.
   * Must run after the pool has logged in.
   */
  async resumeAll(): Promise<void> {
    const stateDir = this.deps.config.state.dir;
    const files = await listPersistedStateFiles(stateDir);
    for (const { guildId, channelId } of files) {
      const filePath = stateFilePath(stateDir, guildId, channelId);
      const restored = await loadState(
        filePath,
        this.deps.config.state.resumeMaxAgeSeconds,
      );
      if (restored === null) {
        await deleteState(filePath);
        continue;
      }
      const base: PlaybackInput = {
        guildId,
        channelId,
        idleTimeoutMs: this.deps.config.idleTimeoutSeconds * 1000,
      };
      const decision = buildResumeInput(restored, base, {
        maxResumeAttempts: MAX_RESUME_ATTEMPTS,
      });
      const hasSomething = (decision.input.initialQueue?.length ?? 0) > 0;
      if (!hasSomething) {
        await deleteState(filePath);
        continue;
      }
      const entry = this.deps.pool.acquire(guildId);
      if (entry === null) {
        log.warn("no userbot available to resume session", {
          guildId,
          channelId,
        });
        continue;
      }
      const session = this.spawn({
        guildId,
        voiceChannelId: channelId,
        statusChannelId: restored.statusChannelId,
        entry,
        input: decision.input,
        resumeKey: decision.resumeKey,
        resumeAttempts: decision.resumeAttempts,
        seekSeconds: decision.input.initialSeekSeconds ?? 0,
      });
      log.info("resumed session", {
        guildId,
        channelId,
        resumedCurrent: decision.resumedCurrent,
        droppedForCrashLoop: decision.droppedForCrashLoop,
      });
      const announcement = buildResumeAnnouncement(restored, decision);
      if (announcement !== null) {
        await this.deps.announce(session.statusChannelId, announcement);
      }
    }
  }

  /** Flush + stop every session (keeping state files for resume). Call on process shutdown. */
  async destroyAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) {
      if (session.checkpointTimer !== null) {
        clearInterval(session.checkpointTimer);
        session.checkpointTimer = null;
      }
      // Persist final position BEFORE stopping — getPosition() goes null once the stream stops.
      await this.saveSnapshot(session);
      session.unsubscribe();
      session.actor.stop();
    }
  }

  private spawn(params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    statusChannelId: ChannelId | null;
    entry: UserbotEntry;
    input: PlaybackInput;
    resumeKey: string | null;
    resumeAttempts: number;
    seekSeconds?: number;
  }): Session {
    const { entry } = params;
    const actors: PlaybackActors = {
      joinVoice: entry.streamer.joinVoice,
      resolveSource: this.deps.resolveSource,
      runStream: entry.streamer.runStream,
      leaveVoice: entry.streamer.leaveVoice,
    };
    const actor = createActor(createPlaybackMachine(actors), {
      input: params.input,
    });
    const reporter = new StatusReporter((message) =>
      this.deps.announce(params.statusChannelId, message),
    );

    const session: Session = {
      key: keyOf(params.guildId, params.voiceChannelId),
      guildId: params.guildId,
      voiceChannelId: params.voiceChannelId,
      statusChannelId: params.statusChannelId,
      entry,
      actor,
      reporter,
      unsubscribe: () => {
        /* replaced once the actor subscription is created below */
      },
      hasStarted: false,
      persistResumeKey: params.resumeKey,
      persistResumeAttempts: params.resumeAttempts,
      resumeConfirmed: false,
      bootAtMs: Date.now(),
      lastKnownPositionSeconds: params.seekSeconds ?? 0,
      checkpointTimer: null,
      snapshotTail: Promise.resolve(),
      torndown: false,
    };

    const subscription = actor.subscribe((snapshot) => {
      const stateValue = snapshot.value;
      const stateName =
        typeof stateValue === "string"
          ? stateValue
          : JSON.stringify(stateValue);
      const snap: StatusSnapshot = {
        state: stateName,
        currentTitle: snapshot.context.resolved?.title ?? null,
        currentRequester: snapshot.context.current?.requesterId ?? null,
        blockedNonce: snapshot.context.blockedNonce,
        blockedRequester: snapshot.context.lastBlockedRequester,
      };
      reporter.handle(snap);
      // Metrics are process-global (unlabeled) gauges inherited from the single-session design:
      // playback state is last-writer across sessions and queue length is the pool-wide total.
      // (Per-(guild,channel) labels are a follow-up if multi-session observability matters.)
      setPlaybackState(stateName);
      queueLength.set(this.totalQueueLength());
      if (stateName !== "idle") {
        session.hasStarted = true;
      } else if (session.hasStarted && snapshot.context.queue.length === 0) {
        this.teardown(session);
      }
    });
    session.unsubscribe = () => {
      subscription.unsubscribe();
    };

    actor.start();
    session.checkpointTimer = setInterval(() => {
      void this.saveSnapshot(session);
    }, CHECKPOINT_MS);
    this.sessions.set(session.key, session);
    return session;
  }

  private handleFor(session: Session): SessionHandle {
    return {
      dispatch: (event) => {
        session.actor.send(event);
      },
      view: () => buildPlaybackView(session.actor.getSnapshot()),
      setVolume: (percent) => session.entry.streamer.setVolume(percent),
      seek: (seconds) => session.entry.streamer.seek(seconds),
    };
  }

  /** Natural session end: nothing playing + empty queue. Release the userbot, drop the state file. */
  private teardown(session: Session): void {
    if (!this.sessions.has(session.key)) {
      return;
    }
    this.sessions.delete(session.key);
    if (session.checkpointTimer !== null) {
      clearInterval(session.checkpointTimer);
      session.checkpointTimer = null;
    }
    session.torndown = true;
    session.unsubscribe();
    session.actor.stop();
    this.deps.pool.release(session.entry);
    // Delete resume state only AFTER any in-flight checkpoint settles (see deleteStateAfterFlush).
    void this.deleteStateAfterFlush(session);
    queueLength.set(this.totalQueueLength());
    if (this.sessions.size === 0) {
      setPlaybackState("idle");
    }
    log.info("session ended", {
      guildId: session.guildId,
      channelId: session.voiceChannelId,
    });
  }

  /**
   * Drain any in-flight checkpoint, then delete the session's resume-state file. A checkpoint that
   * started before teardown could otherwise complete its write AFTER the delete, re-creating a stale
   * file that would wrongly resume the just-finished item on the next boot. `session.torndown` blocks
   * writes still queued on the tail; awaiting the tail drains the one that may already be mid-write.
   */
  private async deleteStateAfterFlush(session: Session): Promise<void> {
    try {
      await session.snapshotTail;
    } catch {
      // Checkpoint write failures are already logged in writeSnapshot; delete regardless.
    }
    await deleteState(
      stateFilePath(
        this.deps.config.state.dir,
        session.guildId,
        session.voiceChannelId,
      ),
    );
  }

  /** Pool-wide queue length across all active sessions (for the global queue-length gauge). */
  private totalQueueLength(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      total += session.actor.getSnapshot().context.queue.length;
    }
    return total;
  }

  /** Serialize snapshot writes per session so a fired interval and the shutdown flush don't race. */
  private saveSnapshot(session: Session): Promise<void> {
    const previous = session.snapshotTail;
    const run = (async (): Promise<void> => {
      await previous;
      await this.writeSnapshot(session);
    })();
    session.snapshotTail = run;
    return run;
  }

  private async writeSnapshot(session: Session): Promise<void> {
    // A checkpoint queued on the tail before teardown must not re-create the deleted state file.
    if (session.torndown) {
      return;
    }
    const { context } = session.actor.getSnapshot();
    const live = session.entry.streamer.getPosition();
    if (context.current === null) {
      session.lastKnownPositionSeconds = 0;
    } else if (live !== null) {
      session.lastKnownPositionSeconds = live;
    }
    playbackPositionSeconds.set(session.lastKnownPositionSeconds);
    if (
      !session.resumeConfirmed &&
      Date.now() - session.bootAtMs >= RESUME_CONFIRM_MS
    ) {
      session.resumeConfirmed = true;
    }
    if (session.resumeConfirmed) {
      session.persistResumeKey =
        context.current === null ? null : resumeKeyFor(context.current.source);
      session.persistResumeAttempts = 0;
    }
    const state = buildSnapshot({
      context,
      positionSeconds: session.lastKnownPositionSeconds,
      savedAt: Date.now(),
      resumeKey: session.persistResumeKey,
      resumeAttempts: session.persistResumeAttempts,
      statusChannelId: session.statusChannelId,
    });
    try {
      await saveState(
        stateFilePath(
          this.deps.config.state.dir,
          session.guildId,
          session.voiceChannelId,
        ),
        state,
      );
    } catch (error) {
      log.error("failed to persist resume state", {
        guildId: session.guildId,
        channelId: session.voiceChannelId,
        error: getErrorMessage(error),
      });
    }
  }
}
