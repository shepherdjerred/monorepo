import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import {
  deleteState,
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
  session.actor.send({
    type: "VOICE_TARGET_MOVED",
    target: { guildId: params.guildId, channelId: params.toChannelId },
  });
  void deleteState(
    stateFilePath(params.stateDir, params.guildId, params.fromChannelId),
  );
  params.logInfo("session voice target moved", {
    guildId: params.guildId,
    fromChannelId: params.fromChannelId,
    toChannelId: params.toChannelId,
  });
  return true;
}
