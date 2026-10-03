import {
  createPosterFetcher,
  type PosterFetcher,
} from "@shepherdjerred/streambot/metadata/tmdb.ts";
import {
  queueLength,
  setPlaybackStates,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import {
  listPersistedStateFiles,
  deleteState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import { moveSessionRecord } from "@shepherdjerred/streambot/session/session-move.ts";
import { buildSessionHandle } from "@shepherdjerred/streambot/session/session-handle.ts";
import {
  resumeSession,
  type ResumeRunnerDeps,
} from "@shepherdjerred/streambot/session/resume-runner.ts";
import {
  keyOf,
  type Session,
  type SessionHandle,
  type SpawnParams,
} from "@shepherdjerred/streambot/session/session-types.ts";
import { VoiceRecoveryCoordinator } from "@shepherdjerred/streambot/session/voice-recovery.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { sessionRevision } from "@shepherdjerred/streambot/session/session-revision.ts";
import { destroySession } from "@shepherdjerred/streambot/session/destroy-session.ts";
import { deleteSessionStateAfterFlush } from "@shepherdjerred/streambot/session/delete-session-state.ts";
import { describeSnapshot } from "@shepherdjerred/streambot/session/status-snapshot.ts";
import { NumberedSessions } from "@shepherdjerred/streambot/session/numbered-sessions.ts";
import { writeSessionSnapshot } from "@shepherdjerred/streambot/session/session-checkpoint.ts";
import { createSession } from "@shepherdjerred/streambot/session/create-session.ts";
import type { PlaybackChannelNumber } from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";

import type { SessionManagerDeps } from "@shepherdjerred/streambot/session/session-types.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";

const log = logger.child("session-manager");

/**
 * Owns room-local playback actors. Numbered rooms share one account lease for 1+2, use additional
 * accounts for 3+, and have one assistant. Legacy mixed queues retain their exclusive account.
 */
export class SessionManager {
  private readonly deps: SessionManagerDeps;
  private readonly sessions = new Map<string, Session>();
  /** Voice-loss incident lifecycle: classify, stop-with-reason, bounded reconnect-with-resume. */
  private readonly voiceRecovery: VoiceRecoveryCoordinator<Session>;
  /** Shared TMDB poster lookup (when configured) — attaches a poster to now-playing announcements. */
  private readonly fetchPoster: PosterFetcher | undefined;
  readonly numbered: NumberedSessions;

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
    this.numbered = new NumberedSessions(deps, this.sessions, (params) =>
      this.spawn(params),
    );
    this.fetchPoster =
      deps.config.tmdb === undefined
        ? undefined
        : createPosterFetcher(deps.config.tmdb.apiKey);
    this.voiceRecovery = new VoiceRecoveryCoordinator<Session>({
      reconnect: deps.config.reconnect,
      stateDir: deps.config.state.dir,
      announce: deps.announce,
      saveSnapshot: (session) => this.saveSnapshot(session),
      discardState: (guildId, channelId, number) =>
        number === undefined
          ? deleteState(
              stateFilePath(deps.config.state.dir, guildId, channelId),
            )
          : this.numbered.persistence.discard(guildId, channelId, number),
      hasActiveSession: (key) => this.sessions.has(key),
      resumeOne: (guildId, channelId, opts) =>
        this.resumeOne(guildId, channelId, {
          origin: "reconnect",
          reconnectAttempts: opts.reconnectAttempts,
          ...(opts.playbackChannel === undefined
            ? {}
            : { playbackChannel: opts.playbackChannel }),
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
    playbackChannel?: PlaybackChannelNumber;
  }): SessionHandle | null {
    if (params.playbackChannel !== undefined)
      return this.numbered.ensure({
        ...params,
        playbackChannel: params.playbackChannel,
      });
    if (
      this.numbered
        .inRoom(params.guildId, params.voiceChannelId)
        .some((session) => session.playbackChannel !== undefined)
    ) {
      throw new PlaybackCommandBoundaryError(
        "This voice channel changed to numbered playback while the request was loading. Try again.",
      );
    }
    const existing = this.sessions.get(
      keyOf(params.guildId, params.voiceChannelId),
    );
    if (existing !== undefined) {
      return buildSessionHandle(this.deps.config, existing);
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
    return buildSessionHandle(this.deps.config, session);
  }

  /** Handle for an already-running session at `(guildId, channelId)`, or null if there is none. */
  getExisting(
    guildId: GuildId,
    channelId: ChannelId,
    playbackChannel?: PlaybackChannelNumber,
    instanceId?: string,
  ): SessionHandle | null {
    const session = this.sessions.get(
      keyOf(guildId, channelId, playbackChannel),
    );
    if (instanceId !== undefined && session?.instanceId !== instanceId)
      return null;
    return session === undefined
      ? null
      : buildSessionHandle(this.deps.config, session);
  }

  revision(
    guildId: GuildId,
    channelId: ChannelId,
    playbackChannel?: PlaybackChannelNumber,
  ): string | null {
    const session = this.sessions.get(
      keyOf(guildId, channelId, playbackChannel),
    );
    return session === undefined ? null : sessionRevision(session);
  }

  /** Release a session that was allocated for a command which produced no playback event. */
  releaseUnused(
    guildId: GuildId,
    channelId: ChannelId,
    playbackChannel?: PlaybackChannelNumber,
  ): void {
    const session = this.sessions.get(
      keyOf(guildId, channelId, playbackChannel),
    );
    if (session === undefined || session.hasStarted) return;
    const snapshot = session.actor.getSnapshot();
    const { stateName } = describeSnapshot(snapshot);
    if (
      stateName !== "idle" ||
      snapshot.context.current !== null ||
      snapshot.context.queue.length > 0
    ) {
      return;
    }
    session.teardownHold.request();
  }

  /** Metadata for the voice-state auto-stop check, or null when no session owns that channel. */
  activeSessionByChannel(
    guildId: GuildId,
    channelId: ChannelId,
  ): {
    voiceChannelId: ChannelId;
    userId: string | null;
    userIds?: readonly string[];
  } | null {
    const session = this.numbered.inRoom(guildId, channelId)[0];
    if (session === undefined) {
      return null;
    }
    return {
      ...(session.playbackChannel === undefined
        ? {}
        : {
            userIds: this.numbered
              .inRoom(guildId, channelId)
              .map((active) => active.entry.userbot.userId()),
          }),
      voiceChannelId: session.voiceChannelId,
      userId: session.entry.userbot.userId(),
    };
  }

  /**
   * Re-render the player card for `(guildId, channelId)` now. Used after a card button applies an
   * effect that doesn't pass through the machine (a live seek), so the channel sees it immediately
   * instead of at the next tick.
   */
  refreshCard(
    guildId: GuildId,
    channelId: ChannelId,
    playbackChannel?: PlaybackChannelNumber,
  ): void {
    this.sessions
      .get(keyOf(guildId, channelId, playbackChannel))
      ?.card.refresh();
  }

  /**
   * A message was posted to a text channel. Every session using it as its status channel counts it
   * toward re-posting its card, so controls don't scroll out of reach in a chatty channel.
   */
  notifyStatusChannelMessage(channelId: ChannelId, messageId: string): void {
    for (const session of this.sessions.values()) {
      if (session.statusChannelId === channelId) {
        session.card.onChannelMessage(messageId);
      }
    }
  }

  /** Re-key a live session when Discord moves the streamer account to another voice channel. */
  moveSession(params: {
    guildId: GuildId;
    fromChannelId: ChannelId;
    toChannelId: ChannelId;
    userId?: string;
  }): boolean {
    const numbered = this.numbered.move(params, (session) =>
      this.saveSnapshot(session),
    );
    if (numbered !== null) return numbered;
    const moved = moveSessionRecord({
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
    if (moved) {
      // The card's click routing is keyed by voice channel, which just changed.
      const session = this.sessions.get(
        keyOf(params.guildId, params.toChannelId),
      );
      session?.card.reown(params.toChannelId);
      session?.voiceAssistant?.moveChannel(params.toChannelId);
    }
    return moved;
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

  private async resumeOne(
    guildId: GuildId,
    channelId: ChannelId,
    opts: {
      origin: "boot" | "reconnect";
      reconnectAttempts?: number;
      playbackChannel?: PlaybackChannelNumber;
    },
  ) {
    const numbered = await this.numbered.resume(guildId, channelId, opts);
    return (
      numbered ??
      resumeSession(this.resumeRunnerDeps(), guildId, channelId, opts)
    );
  }

  private resumeRunnerDeps(): ResumeRunnerDeps {
    return {
      config: this.deps.config,
      pool: this.deps.pool,
      announce: this.deps.announce,
      spawn: (params) => this.spawn(params),
      ...(this.deps.featureGate === undefined
        ? {}
        : { featureGate: this.deps.featureGate }),
    };
  }

  /** Flush + stop every session (keeping state files for resume). Call on process shutdown. */
  async destroyAll(): Promise<void> {
    this.voiceRecovery.cancelAll();
    await this.numbered.shutdown();
    const sessions = [...this.sessions.values()];
    for (const session of sessions) {
      await destroySession(session, (active) => this.saveSnapshot(active));
      if (session.playbackChannel !== undefined)
        await this.numbered.leases.release(session.entry);
    }
    await this.numbered.leases.drain();
    this.sessions.clear();
  }

  /**
   * Gateway-side trigger: the command bot saw the streamer's voice state go to null (kicked or
   * dropped). The ws-close trigger usually beats this and has already torn the session down —
   * then there is nothing to do here.
   */
  notifyStreamerDetached(params: {
    guildId: GuildId;
    channelId: ChannelId;
    userId?: string;
  }): void {
    const session = this.numbered.inRoom(params.guildId, params.channelId)[0];
    if (session === undefined) {
      log.info("streamer detach notification with no active session", params);
      return;
    }
    for (const active of this.numbered.inRoom(
      params.guildId,
      params.channelId,
    )) {
      if (
        params.userId === undefined ||
        active.entry.userbot.userId() === params.userId
      )
        this.beginVoiceRecovery(active);
    }
  }

  /**
   * Abort the in-flight assistant turn first: one that outlives the reconnect delay keeps its
   * teardown hold, so the dead session stays in `sessions` and the recovery timer mistakes it for
   * a live replacement and skips the reconnect entirely.
   */
  private beginVoiceRecovery(session: Session): void {
    session.voiceAssistant?.abortActiveTransaction("voice connection lost");
    void this.voiceRecovery.beginRecovery(session);
  }

  /** The command bot was removed from a guild: stop every session in it (queue cleared, voice left). */
  notifyGuildRemoved(guildId: GuildId): void {
    for (const session of this.sessions.values()) {
      if (session.guildId === guildId) {
        session.actor.send({ type: "GUILD_REMOVED", guildId });
      }
    }
  }

  /** The session's voice channel was deleted: stop that session. */
  notifyChannelDeleted(guildId: GuildId, channelId: ChannelId): void {
    for (const session of this.numbered.inRoom(guildId, channelId))
      session.actor.send({ type: "CHANNEL_DELETED", channelId });
  }

  selectedChannel(
    scope: DiscoveryScope,
  ): Promise<PlaybackChannelNumber | undefined> {
    return this.numbered.selected(scope);
  }
  poolUserIds(): ReadonlySet<string> {
    return this.deps.pool.userIds?.() ?? new Set();
  }
  leaveRoom(guildId: GuildId, channelId: ChannelId): void {
    for (const session of this.numbered.inRoom(guildId, channelId))
      session.actor.send({ type: "LEAVE" });
  }

  private spawn(params: SpawnParams): Session {
    return createSession(params, {
      deps: this.deps,
      fetchPoster: this.fetchPoster,
      sessions: this.sessions,
      teardown: (session) => {
        this.teardown(session);
      },
      beginVoiceRecovery: (session) => {
        this.beginVoiceRecovery(session);
      },
      totalQueueLength: () => this.totalQueueLength(),
      updateStates: () => {
        this.updatePlaybackStates();
      },
      saveSnapshot: (session) => this.saveSnapshot(session),
      refreshAssistant: (guildId, channelId) =>
        this.numbered.refreshAssistant(guildId, channelId),
    });
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
    if (session.playbackChannel !== undefined)
      void this.numbered.refreshAssistant(
        session.guildId,
        session.voiceChannelId,
      );
    if (session.checkpointTimer !== null) {
      clearInterval(session.checkpointTimer);
      session.checkpointTimer = null;
    }
    // Read the final context before stopping the actor: lastError distinguishes an error-driven
    // end (external stop, failed rejoin) from a true natural finish.
    const lastError = session.actor.getSnapshot().context.lastError;
    session.torndown = true;
    // Retire the card while the actor is still readable, so the final render reflects the real
    // end state rather than a stopped actor's snapshot.
    void session.card.finalize();
    session.unsubscribe();
    session.actor.stop();
    session.entry.userbot.setVoiceCloseListener(null);
    session.entry.userbot.setStallListener(null);
    session.voiceAssistant?.close();
    if (session.playbackChannel === undefined) {
      session.entry.userbot.setVoiceAudioListener(null);
      this.deps.pool.release(session.entry);
    } else {
      void this.numbered.leases.release(session.entry);
    }
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
      // Delete resume state only AFTER any in-flight checkpoint settles (see deleteSessionStateAfterFlush).
      if (session.playbackChannel === undefined)
        void deleteSessionStateAfterFlush(this.deps.config.state.dir, session);
      else if (session.instanceId !== undefined)
        void this.numbered.persistence.remove(
          session.guildId,
          session.voiceChannelId,
          session.playbackChannel,
          session.instanceId,
        );
    }
    queueLength.set(this.totalQueueLength());
    this.updatePlaybackStates();
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

  /** Pool-wide queue length across all active sessions (for the global queue-length gauge). */
  private totalQueueLength(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      total += session.actor.getSnapshot().context.queue.length;
    }
    return total;
  }

  private updatePlaybackStates(): void {
    setPlaybackStates(
      [...this.sessions.values()].map(
        (session) => describeSnapshot(session.actor.getSnapshot()).stateName,
      ),
    );
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

  private writeSnapshot(session: Session): Promise<void> {
    return writeSessionSnapshot(
      this.deps.config,
      session,
      this.numbered.persistence,
    );
  }
}
