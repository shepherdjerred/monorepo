import type {
  DareFinalityV2,
  DareProofV2,
} from "#src/betting/dare-proof-v2.ts";

export type DareProofV3 = {
  planVersion: 3;
  compilerVersion: "dare-scoutql-3";
  evaluatorVersion: "dare-evaluator-3";
  queryHash: string;
  value: boolean;
  decisiveAt: string;
  qualifyingMatchIds: string[];
  targetKeys: string[];
  coverage: "complete" | "not_required";
};

export type DareV2SettlementSummary = {
  contractVersion: 2 | 3;
  dareId: number;
  serverId: string;
  channelId: string;
  matchId?: string | undefined;
  resolution: "captured" | "achieved" | "unachieved" | "voided";
  value: boolean | null;
  finality: DareFinalityV2;
  proof: DareProofV2 | DareProofV3 | null;
};

export class DareV2PartialSettlementError extends Error {
  readonly summaries: readonly DareV2SettlementSummary[];
  constructor(summaries: readonly DareV2SettlementSummary[], cause: unknown) {
    super("One or more Dare v2 contracts failed to settle", { cause });
    this.name = "DareV2PartialSettlementError";
    this.summaries = summaries;
  }
}
