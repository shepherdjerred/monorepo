import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import {
  moveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";

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

function keyOf(guildId: GuildId, channelId: ChannelId): string {
  return `${guildId}:${channelId}`;
}

export function moveSessionRecord<TSession extends MovableSession>(
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
