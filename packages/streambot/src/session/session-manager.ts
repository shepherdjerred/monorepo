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
import type {
  PersistedStation,
  StationKind,
} from "@shepherdjerred/streambot/state/station-schema.ts";
import { StationFeeder } from "@shepherdjerred/streambot/station/station-feeder.ts";
import {
  executeVoiceStationControl,
  startSessionStation,
  stopSessionStation,
} from "@shepherdjerred/streambot/station/station-session-ops.ts";
import type { CuratedStationItem } from "@shepherdjerred/streambot/station/station-types.ts";
import { moveLegacyManagedSession } from "@shepherdjerred/streambot/session/session-move.ts";
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
  type SessionManagerDeps,
} from "@shepherdjerred/streambot/session/session-types.ts";
import { VoiceRecoveryCoordinator } from "@shepherdjerred/streambot/session/voice-recovery.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { sessionRevision } from "@shepherdjerred/streambot/session/session-revision.ts";
import {
  destroyAllSessions,
  releaseUnusedSession,
  teardownActiveSession,
} from "@shepherdjerred/streambot/session/destroy-session.ts";
import { describeSnapshot } from "@shepherdjerred/streambot/session/status-snapshot.ts";
import { NumberedSessions } from "@shepherdjerred/streambot/session/numbered-sessions.ts";
import { enqueueSessionSnapshot } from "@shepherdjerred/streambot/session/session-checkpoint.ts";
import { RoomChangeHub } from "@shepherdjerred/streambot/session/room-change-hub.ts";
import { createSession } from "@shepherdjerred/streambot/session/create-session.ts";
import {
  AUDIO_CHANNEL,
  VIDEO_CHANNEL,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";

const log = logger.child("session-manager");

/**
 * Owns room-local playback actors. Numbered rooms share one account lease for 1+2, use additional
 * accounts for 3+, and have one assistant. Legacy mixed queues retain their exclusive account.
 */
export class SessionManager {
  private readonly deps: SessionManagerDeps;
  private readonly sessions = new Map<string, Session>();
  private readonly voiceRecovery: VoiceRecoveryCoordinator<Session>;
  private readonly fetchPoster: PosterFetcher | undefined;
  readonly stationFeeder: StationFeeder;
  readonly numbered: NumberedSessions;
  readonly changes = new RoomChangeHub();

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
    this.stationFeeder = new StationFeeder({
      curators: deps.stationCurators ?? {},
      history: deps.history,
      featureGate: deps.featureGate,
      voiceRoomHumanIds: deps.voiceRoomHumanIds,
      saveSnapshot: (target) => {
        const session = this.sessions.get(target.key);
        return session === undefined
          ? Promise.resolve()
          : this.saveSnapshot(session);
      },
    });
    this.numbered = new NumberedSessions(
      deps,
      this.sessions,
      (params) => this.spawn(params),
      {
        feeder: this.stationFeeder,
        voiceControl: (guildId, voiceChannelId, statusChannelId) => (input) =>
          executeVoiceStationControl({
            guildId,
            voiceChannelId,
            statusChannelId,
            ...input,
            featureGate: this.deps.featureGate,
            resolveTargetSlot: async (scope, _action, kind) =>
              (await this.numbered.automatic(scope))
                ? kind === "tv"
                  ? VIDEO_CHANNEL
                  : AUDIO_CHANNEL
                : await this.numbered.selected(scope),
            onFollowAutoSlot: async (scope, slot) => {
              if (await this.numbered.automatic(scope))
                this.numbered.selection.follow(scope, slot);
            },
            startStation: (params) => this.startStation(params),
            stopStation: (params) => this.stopStation(params),
          }),
      },
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

  ensureForPlay(params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    statusChannelId: ChannelId;
    playbackChannel?: PlaybackChannelNumber | undefined;
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
      return buildSessionHandle(this.deps.config, existing, this.stationFeeder);
    }
    const entry = this.deps.pool.acquire(params.guildId);
    if (entry === null) return null;
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
    return buildSessionHandle(this.deps.config, session, this.stationFeeder);
  }

  startStation(params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    statusChannelId: ChannelId;
    playbackChannel?: PlaybackChannelNumber;
    station: PersistedStation;
    signal?: AbortSignal;
  }): Promise<{
    readonly handle: SessionHandle;
    readonly added: readonly CuratedStationItem[];
  } | null> {
    return startSessionStation({
      config: this.deps.config,
      sessions: this.sessions,
      feeder: this.stationFeeder,
      ensureSession: () => this.ensureForPlay(params),
      saveSnapshot: (session) => this.saveSnapshot(session),
      ...params,
    });
  }

  stopStation(params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    playbackChannel?: PlaybackChannelNumber;
    fallbackInRoom?: boolean;
    kind?: StationKind;
  }): PersistedStation | null {
    return stopSessionStation({
      sessions: this.sessions,
      feeder: this.stationFeeder,
      releaseUnused: (guildId, channelId, slot) => {
        this.releaseUnused(guildId, channelId, slot);
      },
      ...params,
    });
  }

  pokeRoomStations(guildId: GuildId, channelId: ChannelId): void {
    for (const session of this.numbered.inRoom(guildId, channelId))
      this.stationFeeder.poke(session);
  }
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
      : buildSessionHandle(this.deps.config, session, this.stationFeeder);
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

  releaseUnused(
    guildId: GuildId,
    channelId: ChannelId,
    playbackChannel?: PlaybackChannelNumber,
  ): void {
    releaseUnusedSession(this.sessions, guildId, channelId, playbackChannel);
  }

  activeSessionByChannel(
    guildId: GuildId,
    channelId: ChannelId,
  ): {
    voiceChannelId: ChannelId;
    userId: string | null;
    userIds?: readonly string[];
  } | null {
    const session = this.numbered.inRoom(guildId, channelId)[0];
    if (session === undefined) return null;
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

  refreshCard(
    guildId: GuildId,
    channelId: ChannelId,
    playbackChannel?: PlaybackChannelNumber,
  ): void {
    this.sessions
      .get(keyOf(guildId, channelId, playbackChannel))
      ?.card.refresh();
  }

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
    userId?: string;
  }): boolean {
    return (
      this.numbered.move(params, (session) => this.saveSnapshot(session)) ??
      moveLegacyManagedSession({
        stateDir: this.deps.config.state.dir,
        sessions: this.sessions,
        ...params,
      })
    );
  }

  async resumeAll(): Promise<void> {
    for (const { guildId, channelId } of await listPersistedStateFiles(
      this.deps.config.state.dir,
    )) {
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
    return (
      (await this.numbered.resume(guildId, channelId, opts)) ??
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

  destroyAll(): Promise<void> {
    return destroyAllSessions({
      sessions: this.sessions,
      numbered: this.numbered,
      stationFeeder: this.stationFeeder,
      voiceRecovery: this.voiceRecovery,
      saveSnapshot: (active) => this.saveSnapshot(active),
    });
  }

  notifyStreamerDetached(params: {
    guildId: GuildId;
    channelId: ChannelId;
    userId?: string;
  }): void {
    const inRoom = this.numbered.inRoom(params.guildId, params.channelId);
    if (inRoom.length === 0) {
      log.info("streamer detach notification with no active session", params);
      return;
    }
    for (const active of inRoom) {
      if (
        params.userId === undefined ||
        active.entry.userbot.userId() === params.userId
      )
        this.beginVoiceRecovery(active);
    }
  }

  private beginVoiceRecovery(session: Session): void {
    session.voiceAssistant?.abortActiveTransaction("voice connection lost");
    void this.voiceRecovery.beginRecovery(session);
  }

  notifyGuildRemoved(guildId: GuildId): void {
    for (const session of this.sessions.values()) {
      if (session.guildId === guildId) {
        this.stationFeeder.abort(session);
        session.actor.send({ type: "GUILD_REMOVED", guildId });
      }
    }
  }

  notifyChannelDeleted(guildId: GuildId, channelId: ChannelId): void {
    for (const session of this.numbered.inRoom(guildId, channelId)) {
      this.stationFeeder.abort(session);
      session.actor.send({ type: "CHANNEL_DELETED", channelId });
    }
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
    for (const session of this.numbered.inRoom(guildId, channelId)) {
      this.stationFeeder.onBeforeDispatch(session, { type: "LEAVE" });
      session.actor.send({ type: "LEAVE" });
    }
  }

  private spawn(params: SpawnParams): Session {
    return createSession(params, {
      deps: this.deps,
      changes: this.changes,
      stationFeeder: this.stationFeeder,
      controlVoiceStation: ({ session, ...input }) =>
        executeVoiceStationControl({
          guildId: session.guildId,
          voiceChannelId: session.voiceChannelId,
          statusChannelId: session.statusChannelId,
          ...input,
          featureGate: this.deps.featureGate,
          resolveTargetSlot: () => Promise.resolve(undefined),
          startStation: (stationParams) => this.startStation(stationParams),
          stopStation: (stationParams) => this.stopStation(stationParams),
        }),
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
      saveSnapshot: (session, pos) => this.saveSnapshot(session, pos),
      refreshAssistant: (guildId, channelId) =>
        this.numbered.refreshAssistant(guildId, channelId),
    });
  }

  private teardown(session: Session): void {
    teardownActiveSession({
      session,
      sessions: this.sessions,
      stationFeeder: this.stationFeeder,
      numbered: this.numbered,
      pool: this.deps.pool,
      stateDir: this.deps.config.state.dir,
      voiceRecovery: this.voiceRecovery,
      onMetricsRefresh: () => {
        queueLength.set(this.totalQueueLength());
        this.updatePlaybackStates();
      },
    });
  }

  private totalQueueLength(): number {
    let total = 0;
    for (const session of this.sessions.values())
      total += session.actor.getSnapshot().context.queue.length;
    return total;
  }

  private updatePlaybackStates(): void {
    setPlaybackStates(
      [...this.sessions.values()].map(
        (s) => describeSnapshot(s.actor.getSnapshot()).stateName,
      ),
    );
  }

  private saveSnapshot(
    session: Session,
    positionOverrideSeconds?: number,
  ): Promise<void> {
    return enqueueSessionSnapshot(
      this.deps.config,
      session,
      this.numbered.persistence,
      positionOverrideSeconds,
    );
  }
}
