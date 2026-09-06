import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  currentDisclosureKeys,
  currentParticipantDiscordIds,
  effectiveParticipantDiscordId,
} from "#src/progression/duels/series.ts";

export async function getDuelCode(
  db: ExtendedPrismaClient,
  seriesId: string,
  viewerDiscordId: DiscordAccountId,
  guildId: DiscordGuildId,
) {
  const series = await db.duelSeries.findFirstOrThrow({
    where: { id: seriesId, guildId },
    include: {
      participants: true,
      games: {
        orderBy: { gameNumber: "desc" },
        take: 1,
        include: { tournamentLobby: true },
      },
    },
  });
  const currentDiscordIdByPlayer = await currentParticipantDiscordIds(
    db,
    guildId,
    series.participants,
  );
  const disclosureKeys = await currentDisclosureKeys(
    db,
    guildId,
    series.participants,
  );
  const allParticipantsCurrent = series.participants.every((participant) => {
    const currentDiscordId = effectiveParticipantDiscordId(
      currentDiscordIdByPlayer,
      participant,
    );
    return (
      currentDiscordId === participant.discordId &&
      participant.acceptedAt !== null &&
      participant.readyAt !== null &&
      disclosureKeys.has(
        `${participant.playerId.toString()}:${participant.discordId}`,
      )
    );
  });
  const viewerIsAssigned = series.participants.some((participant) => {
    const currentDiscordId = effectiveParticipantDiscordId(
      currentDiscordIdByPlayer,
      participant,
    );
    return (
      currentDiscordId === viewerDiscordId &&
      participant.discordId === viewerDiscordId
    );
  });
  if (!viewerIsAssigned) {
    throw new Error(
      "Tournament codes are visible only to assigned participants",
    );
  }
  if (!allParticipantsCurrent) {
    throw new Error(
      "The tournament code is unavailable until every participant re-accepts",
    );
  }
  const game = series.games[0];
  if (game?.gameState !== "code_ready" || series.seriesState !== "code_ready") {
    throw new Error("The tournament code is not ready yet");
  }
  if (game.tournamentLobby === null) {
    throw new Error("The tournament code is not ready yet");
  }
  return {
    gameId: game.id,
    gameNumber: game.gameNumber,
    code: game.tournamentLobby.code,
    stub: game.tournamentLobby.apiMode === "stub",
  };
}
