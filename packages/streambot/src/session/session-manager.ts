import { createActor } from "xstate";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { StatusReporter } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import { describeSnapshot } from "@shepherdjerred/streambot/session/status-snapshot.ts";
import {
  createPosterFetcher,
  type PosterFetcher,
} from "@shepherdjerred/streambot/metadata/tmdb.ts";
import { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import { buildPlaybackActors } from "@shepherdjerred/streambot/session/playback-actors.ts";
import type {
  ResolvedSource,
  ResolveSourceInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import { buildPlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import {
  PlayerCardManager,
  type PlayerCardPort,
} from "@shepherdjerred/streambot/discord/player-card-manager.ts";
import {
  playbackPositionSeconds,
  queueLength,
  setPlaybackState,
  voiceReconnectsTotal,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import type { UserbotProvider } from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import {
  listPersistedStateFiles,
  saveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  buildSnapshot,
  resumeKeyFor,
} from "@shepherdjerred/streambot/state/resume.ts";
import { moveSessionRecord } from "@shepherdjerred/streambot/session/session-move.ts";
import { buildSessionHandle } from "@shepherdjerred/streambot/session/session-handle.ts";
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
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { LocalVoiceModels } from "@shepherdjerred/streambot/voice/local-models.ts";
import { TeardownHold } from "@shepherdjerred/streambot/session/teardown-hold.ts";
import { createSessionVoiceAssistant } from "@shepherdjerred/streambot/session/voice-session-factory.ts";
import { destroySession } from "@shepherdjerred/streambot/session/destroy-session.ts";
import { deleteSessionStateAfterFlush } from "@shepherdjerred/streambot/session/delete-session-state.ts";

const log = logger.child("session-manager");

export type SessionManagerDeps = {
  readonly config: Config;
  readonly pool: UserbotProvider;
  /** Resolve a queued source to an ffmpeg input (injected so the machine stays pure + testable). */
  readonly resolveSource: (
    input: ResolveSourceInput,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  /** Post a world-readable notice to a channel (no-op when the channel is null/unknown). */
  readonly announce: (
    channelId: ChannelId | null,
    message: string,
  ) => Promise<void>;
  /** Discord effects for the player card, plus its message → session routing table. */
  readonly cards: PlayerCardPort;
  readonly library?: () => readonly LibraryEntry[];
  readonly resolvePlaySource?: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  readonly voiceModels?: LocalVoiceModels | null;
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
  private readonly voiceRecovery: VoiceRecoveryCoordinator<Session>;
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
  getExisting(guildId: GuildId, channelId: ChannelId): SessionHandle | null {
    const session = this.sessions.get(keyOf(guildId, channelId));
    return session === undefined
      ? null
      : buildSessionHandle(this.deps.config, session);
  }

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

  /**
   * Re-render the player card for `(guildId, channelId)` now. Used after a card button applies an
   * effect that doesn't pass through the machine (a live seek), so the channel sees it immediately
   * instead of at the next tick.
   */
  refreshCard(guildId: GuildId, channelId: ChannelId): void {
    this.sessions.get(keyOf(guildId, channelId))?.card.refresh();
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

  moveSession(params: {
    guildId: GuildId;
    fromChannelId: ChannelId;
    toChannelId: ChannelId;
  }): boolean {
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
      this.sessions
        .get(keyOf(params.guildId, params.toChannelId))
        ?.card.reown(params.toChannelId);
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

  async destroyAll(): Promise<void> {
    this.voiceRecovery.cancelAll();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) {
      await destroySession(session, (active) => this.saveSnapshot(active));
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
    this.beginVoiceRecovery(session);
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

  notifyGuildRemoved(guildId: GuildId): void {
    for (const session of this.sessions.values()) {
      if (session.guildId === guildId) {
        session.actor.send({ type: "GUILD_REMOVED", guildId });
      }
    }
  }

  notifyChannelDeleted(guildId: GuildId, channelId: ChannelId): void {
    const session = this.sessions.get(keyOf(guildId, channelId));
    session?.actor.send({ type: "CHANNEL_DELETED", channelId });
  }

  private spawn(params: SpawnParams): Session {
    const { entry } = params;
    const actors = buildPlaybackActors({
      entry,
      resolveSource: this.deps.resolveSource,
      teardownHold: () => session.teardownHold,
    });
    const actor = createActor(createPlaybackMachine(actors), {
      input: params.input,
      inspect: createPlaybackInspector(
        keyOf(params.guildId, params.voiceChannelId),
      ),
    });
    const reporter = new StatusReporter((message) =>
      this.deps.announce(params.statusChannelId, message),
    );
    const card = new PlayerCardManager({
      owner: {
        guildId: params.guildId,
        voiceChannelId: params.voiceChannelId,
      },
      statusChannelId: params.statusChannelId,
      port: this.deps.cards,
      view: () =>
        buildPlaybackView(actor.getSnapshot(), entry.userbot.getPosition()),
      enabled: this.deps.config.playerCard.enabled,
      tickMs: this.deps.config.playerCard.tickMs,
      repostAfterMessages: this.deps.config.playerCard.repostAfterMessages,
      ...(this.fetchPoster === undefined
        ? {}
        : { fetchPoster: this.fetchPoster }),
    });

    const session: Session = {
      key: keyOf(params.guildId, params.voiceChannelId),
      guildId: params.guildId,
      voiceChannelId: params.voiceChannelId,
      statusChannelId: params.statusChannelId,
      entry,
      actor,
      reporter,
      card,
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
      voiceAssistant: null,
      teardownHold: new TeardownHold(() => {
        this.teardown(session);
      }),
      requestTeardown: () => {
        /* installed below after the record is initialized */
      },
    };
    session.requestTeardown = () => {
      session.teardownHold.request();
    };
    session.voiceAssistant = createSessionVoiceAssistant(this.deps, session);
    // Trigger 1: the fork's voice ws `close` event (fires even when the main gateway never
    // reports the streamer leaving — the silent-to-EOF case).
    entry.userbot.setVoiceCloseListener(() => {
      this.beginVoiceRecovery(session);
    });
    // Stall watchdog: ffmpeg alive but producing nothing → the machine's bounded stall recovery
    // (retry at position, pipeline ladder). Without this the machine would sit in `streaming`
    // forever on a wedged pipeline.
    entry.userbot.setStallListener((info) => {
      session.actor.send({
        type: "PRODUCER_STALLED",
        reason: info.reason,
        positionSeconds: info.positionSeconds,
      });
    });

    const subscription = actor.subscribe((snapshot) => {
      const { stateName, snap } = describeSnapshot(snapshot);
      reporter.handle(snap);
      card.refresh();
      setPlaybackState(stateName);
      queueLength.set(this.totalQueueLength());
      if (stateName !== "idle") {
        session.hasStarted = true;
      } else if (session.hasStarted && snapshot.context.queue.length === 0) {
        session.requestTeardown();
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
    const lastError = session.actor.getSnapshot().context.lastError;
    session.torndown = true;
    void session.card.finalize();
    session.unsubscribe();
    session.actor.stop();
    session.entry.userbot.setVoiceCloseListener(null);
    session.entry.userbot.setStallListener(null);
    session.voiceAssistant?.close();
    session.entry.userbot.setVoiceAudioListener(null);
    this.deps.pool.release(session.entry);
    const keepFile = session.preserveStateOnTeardown && lastError !== null;
    if (keepFile) {
      log.info("session ended — resume state preserved for reconnect", {
        guildId: session.guildId,
        channelId: session.voiceChannelId,
        lastError,
      });
    } else {
      void deleteSessionStateAfterFlush(this.deps.config.state.dir, session);
    }
    queueLength.set(this.totalQueueLength());
    if (this.sessions.size === 0) {
      setPlaybackState("idle");
    }
    log.info("session ended", {
      guildId: session.guildId,
      channelId: session.voiceChannelId,
    });
    if (
      keepFile &&
      session.recoveredFromVoiceLoss &&
      !session.resumeConfirmed &&
      !session.voiceRecoveryStarted
    ) {
      this.voiceRecovery.rearmAfterFailedRecovery(session);
    }
  }

  private totalQueueLength(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      total += session.actor.getSnapshot().context.queue.length;
    }
    return total;
  }

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
