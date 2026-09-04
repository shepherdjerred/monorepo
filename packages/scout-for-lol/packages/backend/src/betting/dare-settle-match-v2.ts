import {
  resolveQueueTypeFromGame,
  type DareContractV2,
  type RawMatch,
} from "@scout-for-lol/data";
import { isRemakeMatch } from "#src/betting/outcome.ts";

export function matchTouchesDareContractV2(
  matchData: RawMatch,
  contract: DareContractV2,
): boolean {
  const puuids = new Set(
    matchData.info.participants.map((participant) => participant.puuid),
  );
  return contract.targets.some((target) =>
    target.accounts.some((account) => puuids.has(account.puuid)),
  );
}

export function dareV2MatchSettlementContext(matchData: RawMatch) {
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
