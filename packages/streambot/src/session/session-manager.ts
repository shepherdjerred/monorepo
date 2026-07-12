import { createActor } from "xstate";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  StatusReporter,
  type Announcement,
  type StatusSnapshot,
} from "@shepherdjerred/streambot/discord/status-reporter.ts";
import {
  createPosterFetcher,
  type PosterFetcher,
} from "@shepherdjerred/streambot/metadata/tmdb.ts";
import {
  createPlaybackMachine,
  type PlaybackActors,
} from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type {
  ResolvedSource,
  ResolveSourceInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import { buildPlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import {
  sourceIdentity,
  sourceLabel,
} from "@shepherdjerred/streambot/sources/source.ts";
import { listSubtitleCandidatesForSource } from "@shepherdjerred/streambot/sources/subtitle-candidates.ts";
import {
  playbackPositionSeconds,
  queueLength,
  setPlaybackState,
  voiceReconnectsTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import type { UserbotProvider } from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import {
  deleteState,
  listPersistedStateFiles,
  saveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  buildSnapshot,
  resumeKeyFor,
} from "@shepherdjerred/streambot/state/resume.ts";
import { moveSessionRecord } from "@shepherdjerred/streambot/session/session-move.ts";
import {
  resumeSession,
  type ResumeRunnerDeps,
} from "@shepherdjerred/streambot/session/resume-runner.ts";
import {
  CHECKPOINT_MS,
  RESUME_CONFIRM_MS,
  keyOf,
  type Session,
  type SessionHandle,
  type SpawnParams,
} from "@shepherdjerred/streambot/session/session-types.ts";
import { VoiceRecoveryCoordinator } from "@shepherdjerred/streambot/session/voice-recovery.ts";
import { createPlaybackInspector } from "@shepherdjerred/streambot/session/playback-log.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("session-manager");

export type SessionManagerDeps = {
  readonly config: Config;
  readonly pool: UserbotProvider;
  /** Resolve a queued source to an ffmpeg input (injected so the machine stays pure + testable). */
  readonly resolveSource: (
    input: ResolveSourceInput,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  /** Post a world-readable announcement to a channel (no-op when the channel is null/unknown). */
  readonly announce: (
    channelId: ChannelId | null,
    message: Announcement,
  ) => Promise<void>;
};

// Re-exported for existing consumers (command-bot) — the canonical home is session-types.ts.

/**
 * Owns one playback session per `(guild, voice channel)`. A play command acquires a member-userbot
 * from the pool, spins up an isolated XState actor bound to that userbot's streamer, and tears it
 * down (releasing the userbot) when the channel goes idle. Concurrent sessions — across guilds or
 * across channels in one guild — are fully independent.
 */
export class SessionManager {
  private readonly deps: SessionManagerDeps;
  private readonly sessions = new Map<string, Session>();
  /** Voice-loss incident lifecycle: classify, stop-with-reason, bounded reconnect-with-resume. */
  private readonly voiceRecovery: VoiceRecoveryCoordinator<Session>;
  /** Shared TMDB poster lookup (when configured) — attaches a poster to now-playing announcements. */
  private readonly fetchPoster: PosterFetcher | undefined;

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
    this.fetchPoster =
      deps.config.tmdb === undefined
        ? undefined
        : createPosterFetcher(deps.config.tmdb.apiKey);
    this.voiceRecovery = new VoiceRecoveryCoordinator<Session>({
      reconnect: deps.config.reconnect,
      stateDir: deps.config.state.dir,
      announce: deps.announce,
      saveSnapshot: (session) => this.saveSnapshot(session),
      hasActiveSession: (key) => this.sessions.has(key),
      resumeOne: (guildId, channelId, opts) =>
        this.resumeOne(guildId, channelId, {
          origin: "reconnect",
          reconnectAttempts: opts.reconnectAttempts,
        }),
    });
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
      userId: session.entry.userbot.userId(),
    };
  }

  /** Re-key a live session when Discord moves the streamer account to another voice channel. */
  moveSession(params: {
    guildId: GuildId;
    fromChannelId: ChannelId;
    toChannelId: ChannelId;
  }): boolean {
    return moveSessionRecord({
      stateDir: this.deps.config.state.dir,
      ...params,
      getSession: (key) => this.sessions.get(key),
      hasSession: (key) => this.sessions.has(key),
      deleteSession: (key) => {
        this.sessions.delete(key);
      },
      setSession: (key, session) => {
        this.sessions.set(key, session);
      },
      logInfo: (message, metadata) => {
        log.info(message, metadata);
      },
      logWarn: (message, metadata) => {
        log.warn(message, metadata);
      },
    });
  }

  /**
   * Re-create sessions persisted before a restart. For each `(guild, channel)` state file: load it,
   * decide what to resume, acquire a member-userbot, and start the session — announcing once it's up.
   * Skips (and cleans up) files with nothing to resume, and logs when no userbot is free to take one.
   * Must run after the pool has logged in.
   */
  async resumeAll(): Promise<void> {
    const files = await listPersistedStateFiles(this.deps.config.state.dir);
    for (const { guildId, channelId } of files) {
      await this.resumeOne(guildId, channelId, { origin: "boot" });
    }
  }

  private resumeOne(
    guildId: GuildId,
    channelId: ChannelId,
    opts: { origin: "boot" | "reconnect"; reconnectAttempts?: number },
  ) {
    return resumeSession(this.resumeRunnerDeps(), guildId, channelId, opts);
  }

  private resumeRunnerDeps(): ResumeRunnerDeps {
    return {
      config: this.deps.config,
      pool: this.deps.pool,
      announce: this.deps.announce,
      spawn: (params) => this.spawn(params),
    };
  }

  /** Flush + stop every session (keeping state files for resume). Call on process shutdown. */
  async destroyAll(): Promise<void> {
    this.voiceRecovery.cancelAll();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) {
      session.entry.userbot.setVoiceCloseListener(null);
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

  /**
   * Gateway-side trigger: the command bot saw the streamer's voice state go to null (kicked or
   * dropped). The ws-close trigger usually beats this and has already torn the session down —
   * then there is nothing to do here.
   */
  notifyStreamerDetached(params: {
    guildId: GuildId;
    channelId: ChannelId;
  }): void {
    const session = this.sessions.get(keyOf(params.guildId, params.channelId));
    if (session === undefined) {
      log.info("streamer detach notification with no active session", params);
      return;
    }
    void this.voiceRecovery.beginRecovery(session);
  }

  private spawn(params: SpawnParams): Session {
    const { entry } = params;
    const actors: PlaybackActors = {
      joinVoice: entry.userbot.joinVoice,
      resolveSource: this.deps.resolveSource,
      runStream: entry.userbot.runStream,
      leaveVoice: entry.userbot.leaveVoice,
    };
    const actor = createActor(createPlaybackMachine(actors), {
      input: params.input,
      inspect: createPlaybackInspector(
        keyOf(params.guildId, params.voiceChannelId),
      ),
    });
    const reporter = new StatusReporter(
      (message) => this.deps.announce(params.statusChannelId, message),
      this.fetchPoster === undefined ? {} : { fetchPoster: this.fetchPoster },
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
      preserveStateOnTeardown: params.preserveStateOnTeardown ?? false,
      reconnectAttempts: params.reconnectAttempts ?? 0,
      recoveredFromVoiceLoss: params.recoveredFromVoiceLoss ?? false,
      voiceRecoveryStarted: false,
      pendingSubtitleMenu: false,
    };
    // Trigger 1: the fork's voice ws `close` event (fires even when the main gateway never
    // reports the streamer leaving — the silent-to-EOF case).
    entry.userbot.setVoiceCloseListener(() => {
      void this.voiceRecovery.beginRecovery(session);
    });

    const subscription = actor.subscribe((snapshot) => {
      const stateValue = snapshot.value;
      const stateName =
        typeof stateValue === "string"
          ? stateValue
          : JSON.stringify(stateValue);
      const currentSource = snapshot.context.current?.source ?? null;
      const snap: StatusSnapshot = {
        state: stateName,
        currentTitle: snapshot.context.resolved?.title ?? null,
        currentRequester: snapshot.context.current?.requesterId ?? null,
        currentKind: currentSource?.kind ?? null,
        // Available during `resolving` (before a title is known) so the "preparing…" notice can name it.
        currentSourceLabel:
          currentSource === null ? null : sourceLabel(currentSource),
        blockedNonce: snapshot.context.blockedNonce,
        blockedRequester: snapshot.context.lastBlockedRequester,
        lastError: snapshot.context.lastError,
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
      view: () =>
        buildPlaybackView(
          session.actor.getSnapshot(),
          session.entry.userbot.getPosition(),
        ),
      setVolume: (percent) => session.entry.userbot.setVolume(percent),
      seek: (seconds) => session.entry.userbot.seek(seconds),
      listSubtitleCandidates: (signal) => {
        const current = session.actor.getSnapshot().context.current;
        if (current === null) return Promise.resolve([]);
        return listSubtitleCandidatesForSource(
          this.deps.config,
          current.source,
          signal,
        );
      },
      currentSourceId: () => {
        const current = session.actor.getSnapshot().context.current;
        return current === null ? null : sourceIdentity(current.source);
      },
      hasPendingSubtitleMenu: () => session.pendingSubtitleMenu,
      claimSubtitleMenu: () => {
        if (session.pendingSubtitleMenu) return false;
        session.pendingSubtitleMenu = true;
        return true;
      },
      releaseSubtitleMenu: () => {
        session.pendingSubtitleMenu = false;
      },
    };
  }

  /**
   * Session end: nothing playing + empty queue (a natural finish, an external stop, or a failed
   * item on a dead voice connection). Releases the userbot; deletes the state file unless a
   * voice-loss recovery wants it preserved.
   */
  private teardown(session: Session): void {
    if (!this.sessions.has(session.key)) {
      return;
    }
    this.sessions.delete(session.key);
    if (session.checkpointTimer !== null) {
      clearInterval(session.checkpointTimer);
      session.checkpointTimer = null;
    }
    // Read the final context before stopping the actor: lastError distinguishes an error-driven
    // end (external stop, failed rejoin) from a true natural finish.
    const lastError = session.actor.getSnapshot().context.lastError;
    session.torndown = true;
    session.unsubscribe();
    session.actor.stop();
    session.entry.userbot.setVoiceCloseListener(null);
    this.deps.pool.release(session.entry);
    // A preserved file only makes sense for an error-driven end; a natural finish (lastError
    // null) has nothing to resume even mid-recovery, so it cleans up as usual.
    const keepFile = session.preserveStateOnTeardown && lastError !== null;
    if (keepFile) {
      log.info("session ended — resume state preserved for reconnect", {
        guildId: session.guildId,
        channelId: session.voiceChannelId,
        lastError,
      });
    } else {
      // Delete resume state only AFTER any in-flight checkpoint settles (see deleteStateAfterFlush).
      void this.deleteStateAfterFlush(session);
    }
    queueLength.set(this.totalQueueLength());
    if (this.sessions.size === 0) {
      setPlaybackState("idle");
    }
    log.info("session ended", {
      guildId: session.guildId,
      channelId: session.voiceChannelId,
    });
    // A recovery-spawned session that died before proving healthy (e.g. the rejoin failed) —
    // re-arm the retry loop. The voice-drop path (voiceRecoveryStarted) schedules its own.
    if (
      keepFile &&
      session.recoveredFromVoiceLoss &&
      !session.resumeConfirmed &&
      !session.voiceRecoveryStarted
    ) {
      this.voiceRecovery.rearmAfterFailedRecovery(session);
    }
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
    const live = session.entry.userbot.getPosition();
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
      // A confirmed session no longer needs voice-loss recovery scaffolding: count the recovery
      // as a success, reset the incident attempt counter, and let teardown delete state normally.
      if (session.recoveredFromVoiceLoss) {
        voiceReconnectsTotal.inc({ outcome: "success" });
        log.info("voice reconnect confirmed healthy", {
          guildId: session.guildId,
          channelId: session.voiceChannelId,
        });
      }
      session.reconnectAttempts = 0;
      session.preserveStateOnTeardown = false;
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
