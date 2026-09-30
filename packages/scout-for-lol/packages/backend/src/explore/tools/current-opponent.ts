import {
  LeaguePuuidSchema,
  RegionSchema,
  inferStandardLanesWithCurrentPriors,
  type Lane,
  type RawCurrentGameInfo,
  type RawCurrentGameParticipant,
  type Region,
} from "@scout-for-lol/data";
import type { DiscordAccountId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { getActiveGame } from "#src/league/api/spectator.ts";

export type CurrentLaneOpponentResult =
  | {
      kind: "found";
      puuid: string;
      riotId: string;
      region: Region;
      lane: Lane;
    }
  | {
      kind: "unavailable";
      message: string;
    };

type LinkedAccount = { puuid: string; region: Region };
const MIN_LANE_INFERENCE_MARGIN = 2;

function linkedAccounts(
  rows: { accounts: { puuid: string; region: string }[] }[],
): LinkedAccount[] {
  const unique = new Map<string, LinkedAccount>();
  for (const row of rows) {
    for (const account of row.accounts) {
      const parsed = {
        puuid: LeaguePuuidSchema.parse(account.puuid),
        region: RegionSchema.parse(account.region),
      };
      unique.set(`${parsed.region}:${parsed.puuid}`, parsed);
    }
  }
  return [...unique.values()];
}

function laneAssignments(
  participants: RawCurrentGameParticipant[],
): Map<number, Lane> | null {
  if (participants.length !== 10) return null;
  const result = new Map<number, Lane>();
  for (const teamId of [100, 200]) {
    const team = participants
      .map((participant, index) => ({ participant, index }))
      .filter((entry) => entry.participant.teamId === teamId);
    if (team.length !== 5) return null;
    const inferred = inferStandardLanesWithCurrentPriors(
      team.map((entry) => ({
        participantKey: `participant:${entry.index.toString()}`,
        championId: entry.participant.championId,
        spell1Id: entry.participant.spell1Id,
        spell2Id: entry.participant.spell2Id,
      })),
    );
    if (
      inferred.secondBestScore !== null &&
      inferred.bestScore - inferred.secondBestScore <= MIN_LANE_INFERENCE_MARGIN
    ) {
      return null;
    }
    for (const assignment of inferred.assignments) {
      const index = Number(
        assignment.participantKey.replace("participant:", ""),
      );
      if (!Number.isInteger(index)) return null;
      result.set(index, assignment.lane);
    }
  }
  return result;
}

export function findCurrentLaneOpponentInGame(
  account: LinkedAccount,
  game: RawCurrentGameInfo,
): CurrentLaneOpponentResult {
  if (game.mapId !== 11 || game.gameMode !== "CLASSIC") {
    return {
      kind: "unavailable",
      message:
        "Your current game does not have standard Summoner's Rift lanes.",
    };
  }
  const requesterIndex = game.participants.findIndex(
    (participant) => participant.puuid === account.puuid,
  );
  if (requesterIndex === -1) {
    return {
      kind: "unavailable",
      message: "Riot's live game did not identify your linked account.",
    };
  }
  const assignments = laneAssignments(game.participants);
  if (assignments === null) {
    return {
      kind: "unavailable",
      message: "Scout could not infer a reliable lane matchup from this lobby.",
    };
  }
  const lane = assignments.get(requesterIndex);
  if (lane === undefined) {
    return {
      kind: "unavailable",
      message: "Scout could not infer a reliable lane matchup from this lobby.",
    };
  }
  const requester = game.participants.at(requesterIndex);
  if (requester === undefined) {
    throw new Error("Live game requester index did not resolve a participant");
  }
  const opponent = game.participants.find((participant, index) => {
    return (
      participant.teamId !== requester.teamId && assignments.get(index) === lane
    );
  });
  if (opponent === undefined) {
    return {
      kind: "unavailable",
      message: "Riot hid the opposing laner's identity in this lobby.",
    };
  }
  if (opponent.puuid === null) {
    return {
      kind: "unavailable",
      message: "Riot hid the opposing laner's identity in this lobby.",
    };
  }
  return {
    kind: "found",
    puuid: LeaguePuuidSchema.parse(opponent.puuid),
    riotId: opponent.riotId,
    region: account.region,
    lane,
  };
}

export async function resolveCurrentLaneOpponent(input: {
  database: ExtendedPrismaClient;
  requesterId: DiscordAccountId;
  guildIds: string[];
}): Promise<CurrentLaneOpponentResult> {
  const players = await input.database.player.findMany({
    where: {
      discordId: input.requesterId,
      serverId: { in: input.guildIds },
    },
    select: { accounts: { select: { puuid: true, region: true } } },
  });
  const accounts = linkedAccounts(players);
  if (accounts.length === 0) {
    return {
      kind: "unavailable",
      message:
        "Link a League account to your Discord player before asking about your current opponent.",
    };
  }
  const active = await Promise.all(
    accounts.map(async (account) => ({
      account,
      spectator: await getActiveGame(
        LeaguePuuidSchema.parse(account.puuid),
        account.region,
      ),
    })),
  );
  const games = active.filter((entry) => entry.spectator.kind === "in-game");
  if (games.length > 1) {
    return {
      kind: "unavailable",
      message:
        "More than one of your linked accounts is in a game, so Scout cannot choose which opponent you mean.",
    };
  }
  const current = games[0];
  if (current === undefined) {
    const providerUnavailable = active.some(
      (entry) => entry.spectator.kind === "unavailable",
    );
    return {
      kind: "unavailable",
      message: providerUnavailable
        ? "Riot's live-game service is unavailable right now."
        : "None of your linked accounts is currently in a game.",
    };
  }
  if (current.spectator.kind !== "in-game") {
    throw new Error("Filtered spectator result was not in-game");
  }
  return findCurrentLaneOpponentInGame(current.account, current.spectator.game);
}
