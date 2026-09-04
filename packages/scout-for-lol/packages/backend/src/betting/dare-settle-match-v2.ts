import type { DareContractV2, RawMatch } from "@scout-for-lol/data";
import {
  matchTouchesRelationalDare,
  relationalDareMatchContext,
} from "#src/betting/dare-match-eligibility.ts";

export function dareV2MatchSettlementContext(matchData: RawMatch) {
  return relationalDareMatchContext(matchData);
}

export function matchTouchesDareContractV2(
  matchData: RawMatch,
  contract: DareContractV2,
): boolean {
  return matchTouchesRelationalDare(matchData, contract);
}
