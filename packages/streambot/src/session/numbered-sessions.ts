import { PlaybackLeases } from "@shepherdjerred/streambot/session/playback-leases.ts";
import { ChannelSelection } from "@shepherdjerred/streambot/session/channel-selection.ts";
import {
  keyOf,
  EMPTY_HANDLE,
  MAX_RESUME_ATTEMPTS,
  type Session,
  type SessionHandle,
  type SessionManagerDeps,
  type SpawnParams,
} from "@shepherdjerred/streambot/session/session-types.ts";
import { buildSessionHandle } from "@shepherdjerred/streambot/session/session-handle.ts";
import {
  loadRoomState,
  RoomPersistence,
  type PersistedRoom,
} from "@shepherdjerred/streambot/state/room-persistence.ts";
import { stateFilePath } from "@shepherdjerred/streambot/state/persistence.ts";
import {
  buildResumeInput,
  type ResumeDecision,
} from "@shepherdjerred/streambot/state/resume.ts";
import { withMode } from "@shepherdjerred/streambot/sources/source.ts";
import {
  NUMBERED_CHANNEL_HINT,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { ResumeOutcome } from "@shepherdjerred/streambot/session/voice-recovery.ts";
import { createSessionVoiceAssistant } from "@shepherdjerred/streambot/session/voice-session-factory.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import { numberedCommandDeps } from "./numbered-commands.ts";

type NumberedResumeOptions = {
  origin: "boot" | "reconnect";
  reconnectAttempts?: number;
  playbackChannel?: PlaybackChannelNumber;
};

export class NumberedSessions {
  readonly leases: PlaybackLeases;
  readonly persistence: RoomPersistence;
  readonly selection = new ChannelSelection();
  private readonly assistants = new Map<string, Session>();
  private readonly handoffs = new Map<string, Promise<void>>();
  private stopped = false;
  constructor(
    private readonly deps: SessionManagerDeps,
    private readonly sessions: Map<string, Session>,
    private readonly spawn: (params: SpawnParams) => Session,
  ) {
    this.leases = new PlaybackLeases(deps.pool);
    this.persistence = new RoomPersistence(deps.config.state.dir);
  }
  inRoom(guildId: GuildId, channelId: ChannelId): Session[] {
    return [...this.sessions.values()].filter(
      (session) =>
        session.guildId === guildId && session.voiceChannelId === channelId,
    );
  }
  async selected(
    scope: DiscoveryScope,
  ): Promise<PlaybackChannelNumber | undefined> {
    const selected = this.selection.get(scope);
    const guild = GuildIdSchema.parse(scope.guildId);
    const channel = ChannelIdSchema.parse(scope.channelId);
    const active = this.inRoom(guild, channel);
    if (active.length > 0)
      return active[0]?.playbackChannel === undefined ? undefined : selected;
    return (await this.deps.featureGate?.numberedChannels?.(scope)) === true
      ? selected
      : undefined;
  }
  maximum(guildId: string): number {
    if (this.deps.pool.capacityFor === undefined)
      throw new Error("Numbered playback requires pool membership capacity");
    return 1 + this.deps.pool.capacityFor(guildId);
  }
  async select(scope: DiscoveryScope, number: number): Promise<string> {
    return (await this.selected(scope)) === undefined
      ? `Numbered channels are unavailable while a legacy queue is active or the beta is disabled. ${NUMBERED_CHANNEL_HINT}`
      : this.selection.select(scope, number, this.maximum(scope.guildId));
  }
  async automatic(scope: DiscoveryScope): Promise<boolean> {
    return (
      !this.selection.isManual(scope) &&
      (await this.selected(scope)) !== undefined &&
      (await this.deps.featureGate?.automaticChannelRouting?.(scope)) === true
    );
  }
  async reset(scope: DiscoveryScope): Promise<string> {
    if (
      (await this.selected(scope)) === undefined ||
      (await this.deps.featureGate?.automaticChannelRouting?.(scope)) !== true
    )
      return "Automatic channel routing is not enabled here.";
    this.selection.clear(scope);
    return "Automatic channels selected: music uses 1; Plex and sports use 2.";
  }
  async list(scope: DiscoveryScope, page?: number): Promise<string> {
    if ((await this.selected(scope)) === undefined)
      return "Numbered channels are unavailable while a legacy queue is active or the beta is disabled.";
    return this.selection.list(
      scope,
      this.maximum(scope.guildId),
      (number) => {
        const session = this.sessions.get(
          keyOf(
            GuildIdSchema.parse(scope.guildId),
            ChannelIdSchema.parse(scope.channelId),
            number,
          ),
        );
        return session === undefined
          ? null
          : buildSessionHandle(this.deps.config, session);
      },
      page,
    );
  }
  ensure(params: {
    guildId: GuildId;
    voiceChannelId: ChannelId;
    statusChannelId: ChannelId;
    playbackChannel: PlaybackChannelNumber;
  }): SessionHandle | null {
    if (this.stopped)
      throw new PlaybackCommandBoundaryError(
        "Streambot is shutting down. Try again after it restarts.",
      );
    if (params.playbackChannel > this.maximum(params.guildId)) return null;
    const key = keyOf(
      params.guildId,
      params.voiceChannelId,
      params.playbackChannel,
    );
    const existing = this.sessions.get(key);
    if (existing !== undefined)
      return buildSessionHandle(this.deps.config, existing);
    if (this.sessions.has(keyOf(params.guildId, params.voiceChannelId)))
      throw new PlaybackCommandBoundaryError(
        "A legacy queue started while the request was loading. Finish or stop it, then try again.",
      );
    const entry = this.leases.acquire(
      keyOf(params.guildId, params.voiceChannelId),
      params.guildId,
      params.playbackChannel,
    );
    if (entry === null) return null;
    try {
      void this.persistence.discard(
        params.guildId,
        params.voiceChannelId,
        params.playbackChannel,
      );
      const session = this.spawn({
        ...params,
        entry,
        instanceId: crypto.randomUUID(),
        input: {
          guildId: params.guildId,
          channelId: params.voiceChannelId,
          idleTimeoutMs: this.deps.config.idleTimeoutSeconds * 1000,
        },
        resumeKey: null,
        resumeAttempts: 0,
      });
      return buildSessionHandle(this.deps.config, session);
    } catch (error) {
      void this.leases.release(entry);
      throw error;
    }
  }
  async resume(
    guildId: GuildId,
    channelId: ChannelId,
    opts: NumberedResumeOptions,
  ): Promise<ResumeOutcome | null> {
    const loaded = await loadRoomState(
      stateFilePath(this.deps.config.state.dir, guildId, channelId),
      this.deps.config.state.resumeMaxAgeSeconds,
    );
    if (loaded === null) return null;
    await this.persistence.restore(loaded);
    const room = this.persistence.current(guildId, channelId);
    if (room === undefined) throw new Error("Missing restored room state");
    let result: ResumeOutcome = "nothing";
    for (const slot of room.slots) {
      if (
        opts.playbackChannel !== undefined &&
        slot.number !== opts.playbackChannel
      )
        continue;
      const outcome = await this.resumeSlot(room, slot, opts);
      if (outcome !== "nothing") result = outcome;
    }
    return result;
  }

  private async resumeSlot(
    room: PersistedRoom,
    slot: PersistedRoom["slots"][number],
    opts: NumberedResumeOptions,
  ): Promise<ResumeOutcome> {
    const { guildId, channelId } = room;
    if (
      this.sessions.has(keyOf(guildId, channelId, slot.number)) ||
      !this.persistence.isCurrent(room, slot)
    )
      return "nothing";
    if (
      Date.now() - slot.state.savedAt >
      this.deps.config.state.resumeMaxAgeSeconds * 1000
    ) {
      await this.persistence.remove(
        guildId,
        channelId,
        slot.number,
        slot.instanceId,
      );
      return "nothing";
    }
    if (
      !this.deps.pool.canServe(guildId) ||
      slot.number > this.maximum(guildId)
    ) {
      await this.persistence.remove(
        guildId,
        channelId,
        slot.number,
        slot.instanceId,
      );
      return "unresumable";
    }
    const decision = buildResumeInput(
      slot.state,
      {
        guildId,
        channelId,
        idleTimeoutMs: this.deps.config.idleTimeoutSeconds * 1000,
      },
      { maxResumeAttempts: MAX_RESUME_ATTEMPTS },
    );
    if ((decision.input.initialQueue?.length ?? 0) === 0) {
      await this.persistence.remove(
        guildId,
        channelId,
        slot.number,
        slot.instanceId,
      );
      return "nothing";
    }
    const entry = this.leases.acquire(
      keyOf(guildId, channelId),
      guildId,
      slot.number,
    );
    if (entry === null) {
      return "no-userbot";
    }
    try {
      this.spawn({
        guildId,
        voiceChannelId: channelId,
        statusChannelId: slot.state.statusChannelId,
        playbackChannel: slot.number,
        instanceId: slot.instanceId,
        entry,
        input: {
          ...decision.input,
          initialQueue: numberedResumeQueue(decision, slot.number),
        },
        resumeKey: decision.resumeKey,
        resumeAttempts: decision.resumeAttempts,
        seekSeconds: decision.input.initialSeekSeconds ?? 0,
        ...(opts.origin === "reconnect"
          ? {
              recoveredFromVoiceLoss: true,
              reconnectAttempts: opts.reconnectAttempts ?? 1,
              preserveStateOnTeardown: true,
            }
          : {}),
      });
      return "resumed";
    } catch (error) {
      await this.leases.release(entry);
      throw error;
    }
  }

  refreshAssistant(guildId: GuildId, channelId: ChannelId): Promise<void> {
    const room = keyOf(guildId, channelId);
    const previous = this.handoffs.get(room) ?? Promise.resolve();
    const next = (async () => {
      await previous;
      if (this.stopped) return;
      const candidates = this.inRoom(guildId, channelId)
        .filter(
          (session) =>
            session.playbackChannel !== undefined &&
            !session.torndown &&
            !session.voiceRecoveryStarted,
        )
        .sort((a, b) => (a.playbackChannel ?? 0) - (b.playbackChannel ?? 0));
      const desired = candidates[0];
      const current = this.assistants.get(room);
      if (current === desired) return;
      if (current !== undefined) {
        await current.teardownHold.drain();
        current.voiceAssistant?.close();
        current.voiceAssistant = null;
        this.assistants.delete(room);
      }
      if (
        desired === undefined ||
        desired.torndown ||
        desired.voiceRecoveryStarted
      )
        return;
      desired.voiceAssistant = createSessionVoiceAssistant(this.deps, desired, {
        commandsForUser: (userId) => this.voiceCommands(desired, userId),
        afterTurn: (userId) => {
          const scope = { guildId, channelId: desired.voiceChannelId, userId };
          for (const session of this.inRoom(guildId, desired.voiceChannelId)) {
            if (
              !session.hasStarted &&
              session.playbackChannel === this.selection.get(scope)
            )
              session.teardownHold.request();
          }
        },
        holdTeardown: () => {
          const releases = this.inRoom(guildId, desired.voiceChannelId).map(
            (session) => session.teardownHold.acquire(),
          );
          return () => {
            for (const release of releases) release();
          };
        },
        peerUserbotIds: this.deps.pool.userIds?.() ?? new Set(),
      });
      this.assistants.set(room, desired);
    })();
    this.handoffs.set(room, next);
    return next;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const owner of this.assistants.values()) owner.voiceAssistant?.close();
    await Promise.all(this.handoffs.values());
    this.assistants.clear();
  }

  async commandDeps(
    scope: DiscoveryScope,
    statusChannelId: ChannelId | null,
  ): Promise<PlaybackCommandServiceDeps> {
    if (
      this.deps.library === undefined ||
      this.deps.resolvePlaySource === undefined
    )
      throw new Error("Missing playback command services");
    const guildId = GuildIdSchema.parse(scope.guildId);
    const channelId = ChannelIdSchema.parse(scope.channelId);
    return numberedCommandDeps({
      common: {
        ...this.deps,
        guildId,
        channelId,
        library: this.deps.library,
        resolvePlaySource: this.deps.resolvePlaySource,
        view: EMPTY_HANDLE.view,
        dispatch: EMPTY_HANDLE.dispatch,
        setVolume: EMPTY_HANDLE.setVolume,
        seek: EMPTY_HANDLE.seek,
        announce: (message) => this.deps.announce(statusChannelId, message),
        selectChannel: (_speaker, selected) => this.select(scope, selected),
        resetChannel: () => this.reset(scope),
        listChannels: () => this.list(scope),
      },
      config: this.deps.config,
      scope,
      selection: this.selection,
      maximum: this.maximum(guildId),
      automatic: await this.automatic(scope),
      get: (number) => this.sessions.get(keyOf(guildId, channelId, number)),
      ensure: (number) =>
        this.ensure({
          guildId,
          voiceChannelId: channelId,
          statusChannelId: statusChannelId ?? channelId,
          playbackChannel: number,
        }),
    });
  }

  private voiceCommands(
    owner: Session,
    userId: string,
  ): Promise<PlaybackCommandServiceDeps> {
    return this.commandDeps(
      { guildId: owner.guildId, channelId: owner.voiceChannelId, userId },
      owner.statusChannelId,
    );
  }

  move(
    params: {
      guildId: GuildId;
      fromChannelId: ChannelId;
      toChannelId: ChannelId;
      userId?: string;
    },
    checkpoint: (session: Session) => Promise<void>,
  ): boolean | null {
    const moved = this.inRoom(params.guildId, params.fromChannelId).filter(
      (session) =>
        session.playbackChannel !== undefined &&
        (params.userId === undefined ||
          session.entry.userbot.userId() === params.userId),
    );
    if (moved.length === 0) return null;
    const destination = this.inRoom(params.guildId, params.toChannelId);
    const numbers = new Set(moved.map((session) => session.playbackChannel));
    if (
      destination.some(
        (session) =>
          session.playbackChannel === undefined ||
          numbers.has(session.playbackChannel),
      )
    ) {
      for (const session of moved)
        session.actor.send({
          type: "STREAMER_VOICE_DETACHED",
          reason: "streamer moved into occupied playback slots",
        });
      return false;
    }
    // A physical move changes the reply transport immediately. Abort and close its old
    // assistant before it enters a room that may already have an assistant owner.
    for (const session of moved) session.voiceAssistant?.close();
    for (const session of moved) {
      this.sessions.delete(session.key);
      session.voiceChannelId = params.toChannelId;
      session.key = keyOf(
        params.guildId,
        params.toChannelId,
        session.playbackChannel,
      );
      this.sessions.set(session.key, session);
      this.leases.move(
        session.entry,
        keyOf(params.guildId, params.toChannelId),
        params.toChannelId,
      );
      session.actor.send({
        type: "VOICE_TARGET_MOVED",
        target: { guildId: params.guildId, channelId: params.toChannelId },
      });
      session.card.reown(params.toChannelId);
      void (async () => {
        await checkpoint(session);
        if (
          session.playbackChannel !== undefined &&
          session.instanceId !== undefined
        )
          await this.persistence.remove(
            params.guildId,
            params.fromChannelId,
            session.playbackChannel,
            session.instanceId,
          );
      })();
    }
    void (async () => {
      await this.refreshAssistant(params.guildId, params.fromChannelId);
      await this.refreshAssistant(params.guildId, params.toChannelId);
    })();
    return true;
  }
}

function numberedResumeQueue(
  decision: ResumeDecision,
  number: PlaybackChannelNumber,
) {
  const queue = decision.input.initialQueue;
  if (queue === undefined) throw new Error("Missing numbered resume queue");
  return queue.map((item) => ({
    ...item,
    source: withMode(item.source, number === 1 ? "music" : "video"),
  }));
}
