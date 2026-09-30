import { z } from "zod";
import {
  LeaguePuuidSchema,
  RiotTeamIdSchema,
  parseTeam,
  type LeaguePuuid,
  type RawMatch,
  type RiotTeamId,
} from "@scout-for-lol/data";

/**
 * Frozen 10-player roster. Indices are the identity Discord custom IDs
 * carry: a PUUID is 78 characters and Discord's cap is 100.
 *
 * Ordered by Riot's `participantId` so a replay that shuffled `participants`
 * still names the same player at the same index.
 */
export type MatchMvpParticipant = z.infer<typeof MatchMvpParticipantSchema>;
export const MatchMvpParticipantSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  teamId: RiotTeamIdSchema,
  championName: z.string().min(1),
  riotId: z.string().min(1),
});

export type MatchMvpRoster = z.infer<typeof MatchMvpRosterSchema>;
export const MatchMvpRosterSchema = z.strictObject({
  participants: z.array(MatchMvpParticipantSchema).length(10),
});

const RosterSourceParticipantSchema = z.looseObject({
  participantId: z.number().int(),
  puuid: LeaguePuuidSchema,
  teamId: RiotTeamIdSchema,
  championName: z.string().min(1),
  riotIdGameName: z.string().optional(),
  riotIdTagline: z.string().optional(),
  summonerName: z.string().optional(),
});

function displayRiotId(participant: {
  championName: string;
  riotIdGameName?: string | undefined;
  riotIdTagline?: string | undefined;
  summonerName?: string | undefined;
}): string {
  const gameName = participant.riotIdGameName?.trim() ?? "";
  const tagline = participant.riotIdTagline?.trim() ?? "";
  if (gameName.length > 0 && tagline.length > 0) {
    return `${gameName}#${tagline}`;
  }
  if (gameName.length > 0) {
    return gameName;
  }
  const summoner = participant.summonerName?.trim() ?? "";
  return summoner.length > 0 ? summoner : participant.championName;
}

export function freezeMatchMvpRosterFromParticipants(
  matchId: string,
  participants: unknown[],
): MatchMvpRoster {
  if (participants.length !== 10) {
    throw new Error(
      `MVP roster for ${matchId} has ${String(participants.length)} participants, not 10`,
    );
  }
  const parsed = z.array(RosterSourceParticipantSchema).parse(participants);
  const sorted = [...parsed].sort(
    (left, right) => left.participantId - right.participantId,
  );
  return MatchMvpRosterSchema.parse({
    participants: sorted.map((participant) => ({
      puuid: participant.puuid,
      teamId: participant.teamId,
      championName: participant.championName,
      riotId: displayRiotId(participant),
    })),
  });
}

export function freezeMatchMvpRoster(match: RawMatch): MatchMvpRoster {
  return freezeMatchMvpRosterFromParticipants(
    match.metadata.matchId,
    match.info.participants,
  );
}

export function teamLabel(teamId: RiotTeamId): "Blue" | "Red" {
  const team = parseTeam(teamId);
  if (team === undefined) {
    throw new Error(`Riot team id ${String(teamId)} is not Blue or Red`);
  }
  return team === "blue" ? "Blue" : "Red";
}

export function nomineeAt(
  roster: MatchMvpRoster,
  index: number,
): MatchMvpParticipant {
  const participant = roster.participants[index];
  if (participant === undefined) {
    throw new Error(
      `Match MVP roster has no participant at index ${String(index)}`,
    );
  }
  return participant;
}

export function indexOfPuuid(
  roster: MatchMvpRoster,
  puuid: LeaguePuuid,
): number | undefined {
  const index = roster.participants.findIndex(
    (participant) => participant.puuid === puuid,
  );
  return index === -1 ? undefined : index;
}
