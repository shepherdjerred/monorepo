import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import type { PlaybackLeases } from "@shepherdjerred/streambot/session/playback-leases.ts";
import {
  keyOf,
  type Session,
} from "@shepherdjerred/streambot/session/session-types.ts";
import {
  moveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import type { RoomPersistence } from "@shepherdjerred/streambot/state/room-persistence.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("session-manager");

type MovableSession = {
  key: string;
  voiceChannelId: ChannelId;
  readonly actor: { send: (event: PlaybackEvent) => void };
};

type MoveSessionParams<TSession extends MovableSession> = {
  readonly stateDir: string;
  readonly guildId: GuildId;
  readonly fromChannelId: ChannelId;
  readonly toChannelId: ChannelId;
  readonly getSession: (key: string) => TSession | undefined;
  readonly hasSession: (key: string) => boolean;
  readonly deleteSession: (key: string) => void;
  readonly setSession: (key: string, session: TSession) => void;
  readonly logInfo: (message: string, metadata: Record<string, string>) => void;
  readonly logWarn: (message: string, metadata: Record<string, string>) => void;
};

function moveSessionRecord<TSession extends MovableSession>(
  params: MoveSessionParams<TSession>,
): boolean {
  const fromKey = keyOf(params.guildId, params.fromChannelId);
  const session = params.getSession(fromKey);
  if (session === undefined) {
    return false;
  }

  const toKey = keyOf(params.guildId, params.toChannelId);
  if (fromKey === toKey) {
    return true;
  }
  if (params.hasSession(toKey)) {
    params.logWarn("streamer moved into a channel with an existing session", {
      guildId: params.guildId,
      fromChannelId: params.fromChannelId,
      toChannelId: params.toChannelId,
    });
    session.actor.send({
      type: "STREAMER_VOICE_DETACHED",
      reason: "streamer moved into a channel with an existing session",
    });
    return false;
  }

  params.deleteSession(fromKey);
  session.key = toKey;
  session.voiceChannelId = params.toChannelId;
  params.setSession(toKey, session);
  // Move the existing resume-state file to the new channel's path BEFORE notifying the actor.
  // VOICE_TARGET_MOVED only updates context (no state transition), so it triggers no snapshot write —
  // a plain delete-then-hope would leave a crash window with no state file at either path. moveState
  // write-then-deletes (rewriting the file's channel id) so a resumable snapshot is present at all
  // times; the next checkpoint overwrites it.
  void moveState({
    fromPath: stateFilePath(
      params.stateDir,
      params.guildId,
      params.fromChannelId,
    ),
    toPath: stateFilePath(params.stateDir, params.guildId, params.toChannelId),
    guildId: params.guildId,
    channelId: params.toChannelId,
  });
  session.actor.send({
    type: "VOICE_TARGET_MOVED",
    target: { guildId: params.guildId, channelId: params.toChannelId },
  });
  params.logInfo("session voice target moved", {
    guildId: params.guildId,
    fromChannelId: params.fromChannelId,
    toChannelId: params.toChannelId,
  });
  return true;
}

export function moveLegacyManagedSession(input: {
  readonly stateDir: string;
  readonly sessions: Map<string, Session>;
  readonly guildId: GuildId;
  readonly fromChannelId: ChannelId;
  readonly toChannelId: ChannelId;
}): boolean {
  const moved = moveSessionRecord({
    stateDir: input.stateDir,
    guildId: input.guildId,
    fromChannelId: input.fromChannelId,
    toChannelId: input.toChannelId,
    getSession: (key) => input.sessions.get(key),
    hasSession: (key) => input.sessions.has(key),
    deleteSession: (key) => {
      input.sessions.delete(key);
    },
    setSession: (key, session) => {
      input.sessions.set(key, session);
    },
    logInfo: (message, metadata) => {
      log.info(message, metadata);
    },
    logWarn: (message, metadata) => {
      log.warn(message, metadata);
    },
  });
  if (moved) {
    const session = input.sessions.get(keyOf(input.guildId, input.toChannelId));
    session?.card.reown(input.toChannelId);
    session?.voiceAssistant?.moveChannel(input.toChannelId);
  }
  return moved;
}

export function moveNumberedSessions(input: {
  readonly sessions: Map<string, Session>;
  readonly leases: PlaybackLeases;
  readonly persistence: RoomPersistence;
  readonly inRoom: (guildId: GuildId, channelId: ChannelId) => Session[];
  readonly refreshAssistant: (
    guildId: GuildId,
    channelId: ChannelId,
  ) => Promise<void>;
  readonly checkpoint: (session: Session) => Promise<void>;
  readonly params: {
    readonly guildId: GuildId;
    readonly fromChannelId: ChannelId;
    readonly toChannelId: ChannelId;
    readonly userId?: string;
  };
}): boolean | null {
  const { params } = input;
  const moved = input
    .inRoom(params.guildId, params.fromChannelId)
    .filter(
      (session) =>
        session.playbackChannel !== undefined &&
        (params.userId === undefined ||
          session.entry.userbot.userId() === params.userId),
    );
  if (moved.length === 0) return null;
  const destination = input.inRoom(params.guildId, params.toChannelId);
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
    input.sessions.delete(session.key);
    session.voiceChannelId = params.toChannelId;
    session.key = keyOf(
      params.guildId,
      params.toChannelId,
      session.playbackChannel,
    );
    input.sessions.set(session.key, session);
    input.leases.move(
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
      await input.checkpoint(session);
      if (
        session.playbackChannel !== undefined &&
        session.instanceId !== undefined
      ) {
        await input.persistence.remove(
          params.guildId,
          params.fromChannelId,
          session.playbackChannel,
          session.instanceId,
        );
      }
    })();
  }
  void (async () => {
    await input.refreshAssistant(params.guildId, params.fromChannelId);
    await input.refreshAssistant(params.guildId, params.toChannelId);
  })();
  return true;
}
