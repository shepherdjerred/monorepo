import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";

const ENRICHABLE_PLAYER_FIELDS = [
  "riotIdGameName",
  "riotIdName",
  "summonerName",
  "lane",
  "role",
] as const;

/** Enrichment is explicit, absent-only and bound to the same participant/outcome. */
export function enrichCompleteMatch(
  primary: RawMatch,
  evidence: readonly RawMatch[],
): RawMatch {
  const compatible = evidence.filter(
    (match) =>
      match.metadata.matchId === primary.metadata.matchId &&
      match.info.platformId === primary.info.platformId &&
      match.info.queueId === primary.info.queueId &&
      match.info.gameMode === primary.info.gameMode &&
      match.info.gameType === primary.info.gameType &&
      match.info.participants.length === primary.info.participants.length &&
      primary.info.participants.every((player) =>
        match.info.participants.some(
          (other) =>
            other.participantId === player.participantId &&
            other.puuid === player.puuid &&
            other.teamId === player.teamId &&
            other.championId === player.championId &&
            other.win === player.win,
        ),
      ),
  );
  return RawMatchSchema.parse({
    ...primary,
    info: {
      ...primary.info,
      participants: primary.info.participants.map((player) => {
        const peers = compatible.flatMap((match) =>
          match.info.participants.filter(
            (other) => other.participantId === player.participantId,
          ),
        );
        const additions: Record<string, unknown> = {};
        for (const field of ENRICHABLE_PLAYER_FIELDS) {
          if (player[field] !== undefined) continue;
          const known = peers
            .map((other) => other[field])
            .filter((value) => value !== undefined);
          if (known.length > 0 && known.every((value) => value === known[0]))
            additions[field] = known[0];
        }
        return { ...player, ...additions };
      }),
    },
  });
}
