import { resolveQueueTypeFromGame, type RawMatch } from "@scout-for-lol/data";
import { isRemakeMatch } from "#src/betting/outcome.ts";
import type { RelationalDareContract } from "#src/betting/dares/dare-v2-common.ts";

export function matchTouchesRelationalDare(
  matchData: RawMatch,
  contract: RelationalDareContract,
): boolean {
  const puuids = new Set(
    matchData.info.participants.map((participant) => participant.puuid),
  );
  return contract.targets.some((target) =>
    target.accounts.some((account) => puuids.has(account.puuid)),
  );
}

export function relationalDareMatchContext(matchData: RawMatch) {
  if (isRemakeMatch(matchData)) return null;
  const queue = resolveQueueTypeFromGame(
    matchData.info.queueId,
    matchData.info.gameMode,
    matchData.info.gameType,
  );
  if (queue === undefined) return null;
  return {
    queue,
    gameStartAt: new Date(matchData.info.gameStartTimestamp),
    gameEndAt: new Date(matchData.info.gameEndTimestamp),
  };
}
