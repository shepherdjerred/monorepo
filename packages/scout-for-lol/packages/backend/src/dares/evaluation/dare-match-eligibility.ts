import { isRemakeMatch } from "#src/dares/evaluation/remake.ts";
import {
  resolveQueueTypeFromGame,
  type DareContract,
  type CanonicalMatch,
  canonicalMatchTournamentCode,
} from "@scout-for-lol/data";

export function matchTouchesRelationalDare(
  matchData: CanonicalMatch,
  contract: DareContract,
): boolean {
  const puuids = new Set(
    matchData.info.participants.map((participant) => participant.puuid),
  );
  return contract.targets.some((target) =>
    target.accounts.some((account) => puuids.has(account.puuid)),
  );
}

export function relationalDareMatchContext(matchData: CanonicalMatch) {
  if (isRemakeMatch(matchData)) return null;
  const queue = resolveQueueTypeFromGame(
    matchData.info.queueId,
    matchData.info.gameMode,
    matchData.info.gameType,
    canonicalMatchTournamentCode(matchData),
  );
  if (queue === undefined) return null;
  return {
    queue,
    gameStartAt: new Date(matchData.info.gameStartTimestamp),
    gameEndAt: new Date(matchData.info.gameEndTimestamp),
  };
}
