import type {
  ClientClashTeam,
  ClientClashMatch,
} from "./client-clash-types.ts";
import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";
import type { z } from "zod";
import type { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";

export type ClashResultEvidence = {
  readonly platform: string;
  readonly gameId: string;
  readonly puuid: z.input<typeof LeaguePuuidSchema>;
  readonly teamId: number;
  readonly resultSource: MatchDataSource;
  readonly resultConflict: boolean;
  readonly win: boolean | null;
};

/** Only an explicit single-game bracket link can identify the team's result. */
export function enrichClashTeamResults(
  team: ClientClashTeam,
  evidence: readonly ClashResultEvidence[],
): ClientClashTeam {
  return {
    ...team,
    matches: team.matches.map((match) => enrichMatch(team, match, evidence)),
  };
}

function enrichMatch(
  team: ClientClashTeam,
  match: ClientClashMatch,
  evidence: readonly ClashResultEvidence[],
): ClientClashMatch {
  if (match.gameIds.length !== 1 || team.platformId === null) return match;
  const candidates = evidence.filter(
    (row) =>
      row.platform === team.platformId &&
      row.gameId === match.gameIds[0] &&
      team.memberPuuids.includes(row.puuid),
  );
  const riot = candidates.filter((row) => row.resultSource === "RIOT");
  const selected = riot.length > 0 ? riot : candidates;
  const first = selected[0];
  if (first === undefined) return match;
  if (
    first.win === null ||
    selected.some(
      (row) =>
        row.resultConflict ||
        row.win !== first.win ||
        row.teamId !== first.teamId,
    )
  )
    return { ...match, result: "pending" };
  const result = first.win ? "won" : "lost";
  return {
    ...match,
    result:
      riot.length > 0 || match.result === "pending" || match.result === result
        ? result
        : "pending",
  };
}
