import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type VoiceChannel,
} from "discord.js";
import type {
  CustomActivityClaims,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { type CustomActivityActor } from "#src/customs/activity-actor.ts";
import type { CustomRevisionInput as RevisionInput } from "#src/customs/activity-mutation-context.ts";
import { gameContext } from "#src/customs/game-context.ts";
import { commitCustomMutation } from "#src/customs/repository.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import { client as discordClient } from "#src/discord/client.ts";
import { createLogger } from "#src/logger.ts";

const VOICE_ATTEMPTS = 3;
const logger = createLogger("customs-voice");

type CreatedVoiceChannels = {
  readonly teamA: VoiceChannel;
  readonly teamB?: VoiceChannel | undefined;
};

type CompleteVoiceChannels = {
  readonly teamA: VoiceChannel;
  readonly teamB: VoiceChannel;
};

type VoiceArrangement =
  | { readonly ok: true; readonly channels: CompleteVoiceChannels }
  | {
      readonly ok: false;
      readonly channels: CreatedVoiceChannels;
      readonly error: unknown;
    };

export async function captureCustomVoiceArrangement<T>(
  channels: T,
  movePlayers: () => Promise<void>,
): Promise<
  | { readonly ok: true; readonly channels: T }
  | { readonly ok: false; readonly channels: T; readonly error: unknown }
> {
  try {
    await movePlayers();
    return { ok: true, channels };
  } catch (error) {
    return { ok: false, channels, error };
  }
}

export async function retryCustomVoiceOperation<T>(
  operation: () => Promise<T>,
  delay: (milliseconds: number) => Promise<void> = async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= VOICE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < VOICE_ATTEMPTS) await delay(250 * attempt);
    }
  }
  throw new Error("Discord voice operation failed after three attempts", {
    cause: lastError,
  });
}

async function voiceContext(
  claims: CustomActivityClaims,
  input: RevisionInput,
): ReturnType<typeof gameContext> {
  return gameContext(claims, input, true);
}

async function customGuild(actor: CustomActivityActor): Promise<Guild> {
  return customGuildById(actor.guildId);
}

async function customGuildById(guildId: string): Promise<Guild> {
  const cached = discordClient.guilds.cache.get(guildId);
  return cached ?? discordClient.guilds.fetch(guildId);
}

async function voiceChannel(
  guild: Guild,
  channelId: string,
): Promise<VoiceChannel> {
  const channel = await guild.channels.fetch(channelId);
  if (channel?.type !== ChannelType.GuildVoice) {
    throw new Error(
      "Customs voice channel is missing or is not a voice channel",
    );
  }
  return channel;
}

async function createTeamChannel(
  guild: Guild,
  lobby: VoiceChannel,
  name: string,
  memberIds: readonly string[],
): Promise<VoiceChannel> {
  return guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent: lobby.parentId,
    userLimit: 5,
    reason: "Scout Customs team voice",
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.Connect],
      },
      {
        id: guild.client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
      },
      ...memberIds.map((id) => ({
        id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
      })),
    ],
  });
}

async function moveMember(
  guild: Guild,
  discordId: string,
  sourceIds: ReadonlySet<string>,
  destination: VoiceChannel,
): Promise<void> {
  const member: GuildMember = await retryCustomVoiceOperation(() =>
    guild.members.fetch(discordId),
  );
  if (
    member.voice.channelId !== null &&
    sourceIds.has(member.voice.channelId)
  ) {
    await retryCustomVoiceOperation(() =>
      member.voice.setChannel(destination, "Scout Customs team assignment"),
    );
  }
}

async function createAndMoveTeams(
  actor: CustomActivityActor,
  snapshot: CustomNightSnapshot,
): Promise<VoiceArrangement> {
  const game = snapshot.currentGame;
  if (game === null) throw new Error("There is no current custom game");
  const guild = await customGuild(actor);
  const lobby = await voiceChannel(guild, snapshot.voiceLobbyChannelId);
  const teamAIds = game.participants
    .filter((participant) => participant.team === "A")
    .map((participant) => participant.discordId);
  const teamBIds = game.participants
    .filter((participant) => participant.team === "B")
    .map((participant) => participant.discordId);
  if (teamAIds.length !== 5 || teamBIds.length !== 5) {
    throw new Error("Complete both teams before arranging voice");
  }
  const teamA = await createTeamChannel(
    guild,
    lobby,
    `Customs ${game.sequence.toString()} — Team A`,
    teamAIds,
  );
  let teamB: VoiceChannel;
  try {
    teamB = await createTeamChannel(
      guild,
      lobby,
      `Customs ${game.sequence.toString()} — Team B`,
      teamBIds,
    );
  } catch (error) {
    return { ok: false, channels: { teamA }, error };
  }
  const sourceIds = new Set([lobby.id, teamA.id, teamB.id]);
  return captureCustomVoiceArrangement({ teamA, teamB }, async () => {
    for (const participant of game.participants) {
      await moveMember(
        guild,
        participant.discordId,
        sourceIds,
        participant.team === "A" ? teamA : teamB,
      );
    }
  });
}

async function latestSnapshot(
  nightId: string,
  actor: CustomActivityActor,
): Promise<CustomNightSnapshot> {
  const snapshot = await buildCustomNightSnapshot(
    prisma,
    nightId,
    actor.discordId,
    { viewerAdministrator: actor.administrator },
  );
  if (snapshot === undefined) throw new Error("Custom night disappeared");
  return snapshot;
}

async function cleanCreatedChannels(
  actor: CustomActivityActor,
  snapshot: CustomNightSnapshot,
  channels: CreatedVoiceChannels,
): Promise<void> {
  const guild = await customGuild(actor);
  const lobby = await voiceChannel(guild, snapshot.voiceLobbyChannelId);
  const sources = new Set(
    [channels.teamA.id, channels.teamB?.id].filter(
      (channelId) => channelId !== undefined,
    ),
  );
  for (const participant of snapshot.currentGame?.participants ?? []) {
    await moveMember(guild, participant.discordId, sources, lobby);
  }
  await retryCustomVoiceOperation(async () => {
    await channels.teamA.delete("Scout Customs provisioning rollback");
  });
  if (channels.teamB !== undefined) {
    const teamB = channels.teamB;
    await retryCustomVoiceOperation(async () => {
      await teamB.delete("Scout Customs provisioning rollback");
    });
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown voice operation failure";
}

async function recordVoiceFailure(input: {
  actor: CustomActivityActor;
  nightId: string;
  gameId: string;
  provisioning: CustomNightSnapshot;
  channels: CreatedVoiceChannels | undefined;
  error: unknown;
}): Promise<void> {
  let cleanupError: unknown;
  if (input.channels !== undefined) {
    try {
      await cleanCreatedChannels(
        input.actor,
        input.provisioning,
        input.channels,
      );
    } catch (error_) {
      cleanupError = error_;
      logger.error("Customs voice rollback requires operator recovery", {
        error: error_,
        gameId: input.gameId,
        nightId: input.nightId,
        teamAVoiceChannelId: input.channels.teamA.id,
        teamBVoiceChannelId: input.channels.teamB?.id,
      });
    }
  }
  const failed = await latestSnapshot(input.nightId, input.actor);
  if (failed.currentGame?.id !== input.gameId) throw input.error;
  const teamAVoiceChannelId =
    cleanupError === undefined ? null : (input.channels?.teamA.id ?? null);
  const teamBVoiceChannelId =
    cleanupError === undefined ? null : (input.channels?.teamB?.id ?? null);
  await commitCustomMutation(
    prisma,
    {
      nightId: input.nightId,
      expectedRevision: failed.revision,
      actorId: input.actor.discordId,
      action: "VOICE_FAILED",
      payload: {
        error: errorMessage(input.error),
        cleanupError:
          cleanupError === undefined ? null : errorMessage(cleanupError),
      },
      source: "DISCORD",
      now: new Date(),
      gameId: input.gameId,
    },
    async (transaction) => {
      await transaction.customNight.update({
        where: { id: input.nightId },
        data: { teamAVoiceChannelId, teamBVoiceChannelId },
      });
      await transaction.customGame.update({
        where: { id: input.gameId },
        data: {
          voiceState: "FAILED",
          voiceReady: false,
          voiceError: errorMessage(input.error),
        },
      });
    },
  );
}

export async function arrangeCustomVoice(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await voiceContext(claims, input);
  const game = snapshot.currentGame;
  if (game?.state !== "LOBBY_READY") {
    throw new Error("Tournament lobby must be ready before arranging voice");
  }
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "VOICE_PROVISIONING",
      payload: {},
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGame.update({
        where: { id: game.id },
        data: { voiceState: "PROVISIONING", voiceError: null },
      });
    },
  );
  const provisioning = await latestSnapshot(input.nightId, actor);
  let channels: CreatedVoiceChannels | undefined;
  try {
    const arrangement = await createAndMoveTeams(actor, provisioning);
    channels = arrangement.channels;
    if (!arrangement.ok) throw arrangement.error;
    const createdChannels = arrangement.channels;
    await commitCustomMutation(
      prisma,
      {
        nightId: input.nightId,
        expectedRevision: provisioning.revision,
        actorId: actor.discordId,
        action: "VOICE_READY",
        payload: {
          teamAVoiceChannelId: createdChannels.teamA.id,
          teamBVoiceChannelId: createdChannels.teamB.id,
        },
        source: "DISCORD",
        now: new Date(),
        gameId: game.id,
      },
      async (transaction) => {
        await transaction.customNight.update({
          where: { id: input.nightId },
          data: {
            teamAVoiceChannelId: createdChannels.teamA.id,
            teamBVoiceChannelId: createdChannels.teamB.id,
          },
        });
        await transaction.customGame.update({
          where: { id: game.id },
          data: {
            voiceState: "READY",
            voiceReady: true,
            voiceError: null,
          },
        });
      },
    );
  } catch (error) {
    await recordVoiceFailure({
      actor,
      nightId: input.nightId,
      gameId: game.id,
      provisioning,
      channels,
      error,
    });
  }
  await publishCustomNightSnapshot(input.nightId);
  return latestSnapshot(input.nightId, actor);
}

async function returnPlayersAndDelete(
  guildId: string,
  snapshot: CustomNightSnapshot,
): Promise<void> {
  const guild = await customGuildById(guildId);
  const lobby = await voiceChannel(guild, snapshot.voiceLobbyChannelId);
  const ids = [
    snapshot.teamAVoiceChannelId,
    snapshot.teamBVoiceChannelId,
  ].filter((id) => id !== null);
  const sources = new Set(ids);
  for (const participant of snapshot.currentGame?.participants ?? []) {
    await moveMember(guild, participant.discordId, sources, lobby);
  }
  for (const id of ids) {
    const channel = await guild.channels.fetch(id);
    if (channel !== null) {
      await retryCustomVoiceOperation(async () => {
        await channel.delete("Scout Customs return to lobby");
      });
    }
  }
}

export async function cleanExpiredCustomVoice(nightId: string): Promise<void> {
  const night = await prisma.customNight.findUnique({
    where: { id: nightId },
    select: { guildId: true, hostDiscordId: true },
  });
  if (night === null) throw new Error(`Custom night ${nightId} disappeared`);
  const snapshot = await buildCustomNightSnapshot(
    prisma,
    nightId,
    night.hostDiscordId,
  );
  if (snapshot === undefined) {
    throw new Error(`Custom night ${nightId} disappeared`);
  }
  if (
    snapshot.teamAVoiceChannelId === null &&
    snapshot.teamBVoiceChannelId === null
  ) {
    return;
  }
  await returnPlayersAndDelete(night.guildId, snapshot);
}

export async function returnCustomVoiceToLobby(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await voiceContext(claims, input);
  const game = snapshot.currentGame;
  if (game === null) throw new Error("There is no current custom game");
  if (
    snapshot.teamAVoiceChannelId === null &&
    snapshot.teamBVoiceChannelId === null
  ) {
    return snapshot;
  }
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "VOICE_RETURNING",
      payload: {},
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGame.update({
        where: { id: game.id },
        data: { voiceState: "RETURNING" },
      });
    },
  );
  const returning = await latestSnapshot(input.nightId, actor);
  await returnPlayersAndDelete(actor.guildId, returning);
  await commitCustomMutation(
    prisma,
    {
      nightId: input.nightId,
      expectedRevision: returning.revision,
      actorId: actor.discordId,
      action: "VOICE_CLEANED_UP",
      payload: {},
      source: "DISCORD",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customNight.update({
        where: { id: input.nightId },
        data: { teamAVoiceChannelId: null, teamBVoiceChannelId: null },
      });
      await transaction.customGame.update({
        where: { id: game.id },
        data: { voiceState: "IDLE", voiceReady: false, voiceError: null },
      });
    },
  );
  await publishCustomNightSnapshot(input.nightId);
  return latestSnapshot(input.nightId, actor);
}
