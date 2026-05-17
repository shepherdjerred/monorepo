import { entries, groupBy, map, pipe, sortBy } from "remeda";
import { z } from "zod";
import {
  ArenaPlacementSchema,
  type ArenaTeam,
  ArenaTeamIdSchema,
  type ArenaTeamId,
  type CompletedMatch,
  CompletedMatchSchema,
  getLaneOpponent,
  invertTeam,
  resolveQueueTypeFromGame,
  parseTeam,
  type Player,
  type Rank,
  type ArenaMatch,
  type RawMatch,
  type RawParticipant,
  findParticipant,
  getOutcome,
  getTeams,
  PlayerConfigEntrySchema,
} from "@scout-for-lol/data/index.ts";
import { strict as assert } from "node:assert";
import { participantToArenaChampion } from "#src/league/model/champion.ts";
import { participantToChampion } from "@scout-for-lol/data/model/match-helpers.ts";
import { createLogger } from "#src/logger.ts";
import { participantMismatchTotal } from "#src/metrics/index.ts";

const logger = createLogger("model-match");

export function toMatch(
  players: Player[],
  rawMatch: RawMatch,
  playerRanks: Map<
    string,
    { before: Rank | undefined; after: Rank | undefined }
  >,
): CompletedMatch | undefined {
  const teams = getTeams(rawMatch.info.participants, participantToChampion);
  const queueType = resolveQueueTypeFromGame(
    rawMatch.info.queueId,
    rawMatch.info.gameMode,
  );

  if (queueType === "arena") {
    throw new Error("arena matches are not supported");
  }

  // Build CompletedMatch.players for all tracked players, skipping any with missing participant data
  const matchPlayers = players
    .map((player) => {
      // CRITICAL: Validate player.config doesn't have puuid at top level
      // This ensures no participant data leaks into player config
      const configValidation = PlayerConfigEntrySchema.safeParse(player.config);
      if (!configValidation.success) {
        throw new Error(
          `Invalid player config for ${player.config.alias}: config has unexpected fields`,
        );
      }
      // Use validated config to ensure no extra fields
      const validatedConfig = configValidation.data;

      const participantRaw = findParticipant(
        player.config.league.leagueAccount.puuid,
        rawMatch.info.participants,
      );
      if (participantRaw === undefined) {
        const searchingFor = player.config.league.leagueAccount.puuid;
        const metadataPuuids = rawMatch.metadata.participants;
        const infoPuuids = rawMatch.info.participants.map((p) => p.puuid);

        // Known Riot API bug: metadata.participants lists a PUUID but info.participants has no matching entry
        // https://github.com/RiotGames/developer-relations/issues/898
        logger.warn(
          "Participant mismatch: in metadata but not in info (skipping player)",
          {
            searchingFor,
            playerAlias: player.config.alias,
            matchId: rawMatch.metadata.matchId,
            queueId: rawMatch.info.queueId,
            inMetadata: metadataPuuids.includes(searchingFor),
            inInfo: infoPuuids.includes(searchingFor),
            metadataPuuids,
            infoPuuids,
            metadataCount: metadataPuuids.length,
            infoCount: infoPuuids.length,
            mismatchedCounts: metadataPuuids.length !== infoPuuids.length,
            emptyPuuidsInInfo: infoPuuids.filter((p) => p === "").length,
          },
        );

        participantMismatchTotal.inc({ queue_type: queueType ?? "unknown" });
        return;
      }

      // TypeScript needs explicit narrowing after the undefined check
      const participant: RawParticipant = participantRaw;

      const champion = participantToChampion(participant);
      const team = parseTeam(participant.teamId);

      assert.ok(team !== undefined);

      const enemyTeam = invertTeam(team);

      // Get per-player rank data from the map
      const puuid = player.config.league.leagueAccount.puuid;
      const ranks = playerRanks.get(puuid) ?? {
        before: undefined,
        after: undefined,
      };

      const playerObject = {
        playerConfig: validatedConfig,
        rankBeforeMatch: ranks.before,
        rankAfterMatch: ranks.after,
        wins:
          queueType === "solo" || queueType === "flex"
            ? (player.ranks[queueType]?.wins ?? undefined)
            : undefined,
        losses:
          queueType === "solo" || queueType === "flex"
            ? (player.ranks[queueType]?.losses ?? undefined)
            : undefined,
        champion,
        outcome: getOutcome(participant),
        team: team,
        lane: champion.lane,
        laneOpponent: getLaneOpponent(champion, teams[enemyTeam]),
      };

      return playerObject;
    })
    .filter((p) => p !== undefined);

  if (matchPlayers.length === 0) {
    return undefined;
  }

  const result: CompletedMatch = {
    queueType,
    players: matchPlayers,
    durationInSeconds: rawMatch.info.gameDuration,
    teams,
  };

  const validated = CompletedMatchSchema.parse(result);
  return validated;
}

function validateArenaSubteamId(participant: RawParticipant): ArenaTeamId {
  return ArenaTeamIdSchema.parse(participant.playerSubteamId);
}

const ArenaParticipantFieldsSchema = z.object({
  playerSubteamId: z.number().int().min(1).max(8),
  placement: z.number().int().min(1).max(8),
});

type ArenaParticipantValidatedMin = RawParticipant & {
  playerSubteamId: ArenaTeamId;
};

export function groupArenaTeams(participants: RawParticipant[]) {
  const validated: ArenaParticipantValidatedMin[] = participants.map((p) => {
    const playerSubteamId = validateArenaSubteamId(p);
    return { ...p, playerSubteamId };
  });
  const bySubteam = groupBy(validated, (e) => e.playerSubteamId);
  const groups = pipe(
    entries(bySubteam),
    map(([key, entriesForKey]) => [Number(key), entriesForKey] as const),
    sortBy(([subteamId]) => subteamId),
    map(([subteamId, players]) => {
      if (players.length !== 2 && players.length !== 3) {
        throw new Error(
          `subteam ${subteamId.toString()} must have 2 or 3 players`,
        );
      }
      return { subteamId, players };
    }),
  );
  if (groups.length !== 6 && groups.length !== 8) {
    throw new Error(
      `expected 6 or 8 subteams, got ${groups.length.toString()}`,
    );
  }

  const expectedTeamSize = groups.length === 6 ? 3 : 2;
  for (const group of groups) {
    if (group.players.length !== expectedTeamSize) {
      throw new Error(
        `subteam ${group.subteamId.toString()} must have ${expectedTeamSize.toString()} players for ${groups.length.toString()}-team Arena`,
      );
    }
  }
  return groups;
}

export function getArenaTeammates(
  participant: RawParticipant,
  participants: RawParticipant[],
) {
  const sub = validateArenaSubteamId(participant);
  const teammates: RawParticipant[] = [];
  for (const p of participants) {
    if (p === participant) {
      continue;
    }
    const otherSub = validateArenaSubteamId(p);
    if (otherSub === sub) {
      teammates.push(p);
    }
  }
  return teammates;
}

export function toArenaSubteams(participants: RawParticipant[]): ArenaTeam[] {
  const grouped = groupArenaTeams(participants);
  const result: ArenaTeam[] = [];
  for (const { subteamId, players } of grouped) {
    const placements = players.map(
      (player) => ArenaParticipantFieldsSchema.parse(player).placement,
    );
    const firstPlacement = placements[0];
    if (firstPlacement === undefined) {
      throw new Error(`subteam ${subteamId.toString()} has no players`);
    }
    if (placements.some((placement) => placement !== firstPlacement)) {
      throw new Error(
        `inconsistent placement for subteam ${subteamId.toString()}: ${placements.join(", ")}`,
      );
    }
    const converted = players.map((p) => participantToArenaChampion(p));
    result.push({
      teamId: ArenaTeamIdSchema.parse(subteamId),
      players: converted,
      placement: ArenaPlacementSchema.parse(firstPlacement),
    });
  }
  return result;
}

export function getArenaPlacement(participant: RawParticipant) {
  return ArenaParticipantFieldsSchema.parse(participant).placement;
}

export function toArenaMatch(
  players: Player[],
  rawMatch: RawMatch,
): ArenaMatch | undefined {
  const subteams = toArenaSubteams(rawMatch.info.participants);

  // Build ArenaMatch.players for all tracked players, skipping any with missing participant data
  const arenaPlayers = players
    .map((player) => {
      // CRITICAL: Validate player.config doesn't have puuid at top level
      // This ensures no participant data leaks into player config
      const configValidation = PlayerConfigEntrySchema.safeParse(player.config);
      if (!configValidation.success) {
        throw new Error(
          `Invalid player config for ${player.config.alias}: config has unexpected fields`,
        );
      }
      // Use validated config to ensure no extra fields
      const validatedConfig = configValidation.data;

      const participant = findParticipant(
        validatedConfig.league.leagueAccount.puuid,
        rawMatch.info.participants,
      );
      if (participant === undefined) {
        const searchingFor = validatedConfig.league.leagueAccount.puuid;
        const metadataPuuids = rawMatch.metadata.participants;
        const infoPuuids = rawMatch.info.participants.map((p) => p.puuid);

        // Known Riot API bug: metadata.participants lists a PUUID but info.participants has no matching entry
        // https://github.com/RiotGames/developer-relations/issues/898
        logger.warn(
          "Arena participant mismatch: in metadata but not in info (skipping player)",
          {
            searchingFor,
            playerAlias: validatedConfig.alias,
            matchId: rawMatch.metadata.matchId,
            queueId: rawMatch.info.queueId,
            inMetadata: metadataPuuids.includes(searchingFor),
            inInfo: infoPuuids.includes(searchingFor),
            metadataPuuids,
            infoPuuids,
            metadataCount: metadataPuuids.length,
            infoCount: infoPuuids.length,
            mismatchedCounts: metadataPuuids.length !== infoPuuids.length,
            emptyPuuidsInInfo: infoPuuids.filter((p) => p === "").length,
          },
        );

        participantMismatchTotal.inc({ queue_type: "arena" });
        return;
      }
      const subteamId = validateArenaSubteamId(participant);
      const placement = getArenaPlacement(participant);
      const champion = participantToArenaChampion(participant);
      const teammateRaws = getArenaTeammates(
        participant,
        rawMatch.info.participants,
      );
      if (teammateRaws.length === 0) {
        throw new Error(
          `arena teammates not found for player ${validatedConfig.alias}`,
        );
      }
      const arenaTeammates = teammateRaws.map((teammateRaw) =>
        participantToArenaChampion(teammateRaw),
      );

      return {
        playerConfig: validatedConfig,
        placement: ArenaPlacementSchema.parse(placement),
        champion,
        teamId: ArenaTeamIdSchema.parse(subteamId),
        teammates: arenaTeammates,
      };
    })
    .filter((p) => p !== undefined);

  if (arenaPlayers.length === 0) {
    return undefined;
  }

  return {
    durationInSeconds: rawMatch.info.gameDuration,
    queueType: "arena",
    players: arenaPlayers,
    teams: subteams,
  } satisfies ArenaMatch;
}
