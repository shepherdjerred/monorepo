import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  TournamentMapTypeSchema,
  TournamentPickTypeSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { createTournamentCodes } from "#src/league/api/tournament/client.ts";
import {
  toPlatformId,
  toTournamentRegion,
} from "#src/league/api/tournament/regions.ts";
import {
  tournamentApiMode,
  tournamentMaxOpenLobbies,
} from "#src/config/dynamic.ts";
import { requireTournamentRegistration } from "#src/league/tournament/registration.ts";
import { resolveLobbyRosters } from "#src/league/tournament/roster-resolution.ts";
import {
  LOBBY_ABANDON_TTL_MS,
  countOpenLobbiesForGuild,
  createLobby,
  findLobbyByCode,
  listLobbiesForGuild,
  updateLobby,
} from "#src/league/tournament/lobby-store.ts";
import { describeLobby } from "#src/league/tournament/prematch-card.ts";
import { isTerminal } from "#src/league/tournament/lifecycle.ts";
import { tournamentLobbiesTotal } from "#src/metrics/tournament.ts";

const logger = createLogger("lobby-command");

/**
 * Slash-command input is a system boundary, so a bad alias gets a friendly
 * ephemeral answer rather than a Sentry event. Everything past this point is
 * validated.
 */
async function replyPrivate(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function executeCreate(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
): Promise<void> {
  const blueRaw = z.string().parse(interaction.options.getString("blue", true));
  const redRaw = z.string().parse(interaction.options.getString("red", true));
  const pickType = TournamentPickTypeSchema.parse(
    interaction.options.getString("pick") ?? "TOURNAMENT_DRAFT",
  );
  const mapType = TournamentMapTypeSchema.parse(
    interaction.options.getString("map") ?? "SUMMONERS_RIFT",
  );

  const openLobbies = await countOpenLobbiesForGuild(prisma, serverId);
  if (openLobbies >= tournamentMaxOpenLobbies()) {
    await replyPrivate(
      interaction,
      `This server already has ${openLobbies.toString()} open lobbies. Cancel one first with /lobby cancel.`,
    );
    return;
  }

  const rosters = await resolveLobbyRosters(prisma, serverId, blueRaw, redRaw);
  if (!rosters.ok) {
    await replyPrivate(interaction, rosters.reason);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const mode = tournamentApiMode();
  const region = rosters.blue.region;
  const tournamentRegion = toTournamentRegion(region);
  const registration = await requireTournamentRegistration(
    prisma,
    mode,
    tournamentRegion,
  );

  const teamSize = Math.max(
    rosters.blue.puuids.length,
    rosters.red.puuids.length,
  );

  const codes = await createTournamentCodes(
    { mode },
    registration.tournamentId,
    1,
    {
      teamSize,
      pickType,
      mapType,
      // ALL by default: if custom-lobby visibility in Spectator correlates with
      // this at all, it maximises the chance the prematch card gets upgraded
      // with a real loading screen. It costs nothing otherwise.
      spectatorType: "ALL",
      enoughPlayers: false,
      // Riot enforces the allow-list in aggregate, not per team, so both sides
      // go in together.
      allowedParticipants: [...rosters.blue.puuids, ...rosters.red.puuids],
    },
  );

  const code = codes[0];
  if (code === undefined) {
    await replyPrivate(interaction, "Riot did not return a tournament code.");
    return;
  }

  await createLobby(prisma, {
    code,
    apiMode: mode,
    providerId: registration.providerId,
    tournamentId: registration.tournamentId,
    region,
    platformId: toPlatformId(region),
    serverId,
    channelId: DiscordChannelIdSchema.parse(interaction.channelId),
    creatorDiscordId: DiscordAccountIdSchema.parse(interaction.user.id),
    bluePuuids: [...rosters.blue.puuids],
    redPuuids: [...rosters.red.puuids],
    blueAliases: [...rosters.blue.aliases],
    redAliases: [...rosters.red.aliases],
    teamSize,
    pickType,
    mapType,
    spectatorType: "ALL",
    lobbyName: undefined,
    password: undefined,
    expiresAt: new Date(Date.now() + LOBBY_ABANDON_TTL_MS),
  });

  tournamentLobbiesTotal.inc({ action: "created" });
  logger.info(`🏟️ Created lobby ${code} for ${serverId}`);

  // The code is the join credential, so it goes only to the creator. The public
  // announcement is the poller's job and deliberately carries no credential.
  await replyPrivate(
    interaction,
    [
      `**Tournament code:** \`${code}\``,
      `${rosters.blue.aliases.join(", ")} vs ${rosters.red.aliases.join(", ")}`,
      `${teamSize.toString()}v${teamSize.toString()} · ${mapType} · ${pickType}`,
      "",
      "Paste the code into the League client to create the lobby.",
      mode === "stub"
        ? "⚠️ Scout is in stub mode, so this code will not create a real lobby."
        : "",
      `Cancel with \`/lobby cancel code:${code}\`.`,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  );
}

async function executeStatus(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
): Promise<void> {
  const lobbies = await listLobbiesForGuild(prisma, serverId);
  const active = lobbies.filter((lobby) => !isTerminal(lobby.state));

  await replyPrivate(
    interaction,
    active.length === 0
      ? "No open custom game lobbies in this server."
      : active.map((lobby) => describeLobby(lobby)).join("\n\n"),
  );
}

async function executeCancel(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
): Promise<void> {
  const code = z.string().parse(interaction.options.getString("code", true));
  const lobby = await findLobbyByCode(prisma, code);

  // Scoped to the calling guild so one server cannot cancel another's lobby.
  if (lobby?.serverId !== serverId) {
    await replyPrivate(interaction, `No lobby with code \`${code}\` here.`);
    return;
  }
  if (isTerminal(lobby.state)) {
    await replyPrivate(interaction, `That lobby is already ${lobby.state}.`);
    return;
  }

  await updateLobby(prisma, lobby.id, { state: "cancelled" });
  tournamentLobbiesTotal.inc({ action: "cancelled" });
  await replyPrivate(interaction, `Cancelled \`${code}\`.`);
}

export async function executeLobby(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.guildId === null) {
    await replyPrivate(interaction, "Custom lobbies only work in a server.");
    return;
  }
  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);

  // Belt-and-braces beyond guild-scoped registration, mirroring how /scout
  // re-checks its allowlist on execution.
  if (!getFlag("tournament_lobbies_enabled", { server: serverId })) {
    await replyPrivate(
      interaction,
      "Custom game lobbies are not enabled in this server.",
    );
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  try {
    if (subcommand === "create") {
      await executeCreate(interaction, serverId);
      return;
    }
    if (subcommand === "status") {
      await executeStatus(interaction, serverId);
      return;
    }
    if (subcommand === "cancel") {
      await executeCancel(interaction, serverId);
      return;
    }
    await replyPrivate(interaction, `Unknown subcommand: ${subcommand}`);
  } catch (error) {
    logger.error(`/lobby ${subcommand} failed`, error);
    await replyPrivate(
      interaction,
      "Something went wrong creating that lobby. The error has been recorded.",
    );
    throw error;
  }
}
