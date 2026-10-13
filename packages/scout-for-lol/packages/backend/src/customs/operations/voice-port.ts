import { customTeamChannelName } from "#src/customs/operations/channel-name.ts";
import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  Status,
} from "discord.js";
import { client } from "#src/discord/client.ts";
import configuration from "#src/configuration.ts";
import { requireVoiceStateAccess } from "#src/customs/voice-capability.ts";
import type { CustomOperationPayload } from "#src/customs/operations/contracts.ts";
import type { CustomVoicePort } from "#src/customs/operations/execution-steps.ts";

/** REST member payloads cannot substitute for the shard's voice-state cache. */
export async function customVoicePort(
  operationId: string,
  payload: CustomOperationPayload,
): Promise<CustomVoicePort> {
  requireVoiceStateAccess("Executing a durable Customs voice operation");
  const assertGateway = () => {
    if (!client.isReady() || client.ws.status !== Status.Ready)
      throw new Error(
        "Customs gateway state is not ready; retry after reconnect",
      );
  };
  assertGateway();
  if (
    payload.action !== "arrange" &&
    payload.snapshot.teamAVoiceChannelId === null &&
    payload.snapshot.teamBVoiceChannelId === null
  ) {
    return {
      assertReady: assertGateway,
      createTeam: () =>
        Promise.reject(
          new Error("This operation cannot create voice channels"),
        ),
      move: () => Promise.resolve(),
      deleteChannel: () => Promise.resolve(),
    };
  }
  const guild = client.guilds.cache.get(payload.snapshot.guildId);
  if (guild?.available !== true)
    throw new Error("Customs guild gateway state is unavailable");
  const assertReady = () => {
    assertGateway();
    if (!guild.available)
      throw new Error("Customs guild gateway state is unavailable");
  };
  const lobby = await guild.channels.fetch(
    payload.snapshot.voiceLobbyChannelId,
  );
  if (lobby?.type !== ChannelType.GuildVoice)
    throw new Error("Customs lobby is missing or is not a voice channel");
  const game = payload.snapshot.currentGame;
  return {
    assertReady,
    createTeam: async (team) => {
      if (game === null)
        throw new Error("Customs voice creation requires a game");
      assertReady();
      const channel = await guild.channels.create({
        name: customTeamChannelName(operationId, game.sequence, team),
        type: ChannelType.GuildVoice,
        parent: lobby.parentId,
        userLimit: 5,
        reason: "Scout Customs durable team voice operation",
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] },
          {
            id: configuration.applicationId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
            ],
          },
          ...game.participants
            .filter((participant) => participant.team === team)
            .map((participant) => ({
              id: participant.discordId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
              ],
            })),
        ],
      });
      return channel.id;
    },
    move: async (discordId, sources, destinationId) => {
      assertReady();
      const voice = guild.voiceStates.cache.get(discordId);
      if (
        voice?.channelId === undefined ||
        voice.channelId === null ||
        !sources.has(voice.channelId)
      )
        return;
      const member = await guild.members.fetch(discordId);
      assertReady();
      // The member may have moved while REST fetched its identity.
      const current = guild.voiceStates.cache.get(discordId)?.channelId;
      if (
        current === undefined ||
        current === null ||
        current === destinationId ||
        !sources.has(current)
      )
        return;
      await member.voice.setChannel(
        destinationId,
        "Scout Customs durable voice operation",
      );
    },
    deleteChannel: async (channelId) => {
      assertReady();
      try {
        const channel = await guild.channels.fetch(channelId);
        if (channel === null) return;
        if (channel.type !== ChannelType.GuildVoice)
          throw new Error("Recorded Customs channel is not a voice channel");
        assertReady();
        await channel.delete("Scout Customs durable voice cleanup");
      } catch (error) {
        if (!(error instanceof DiscordAPIError && error.code === 10_003))
          throw error;
      }
    },
  };
}
