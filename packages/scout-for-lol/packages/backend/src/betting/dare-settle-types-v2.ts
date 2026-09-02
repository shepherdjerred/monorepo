import type {
  DareFinalityV2,
  DareProofV2,
} from "#src/betting/dare-proof-v2.ts";

export type DareV2SettlementSummary = {
  contractVersion: 2;
  dareId: number;
  serverId: string;
  channelId: string;
  matchId?: string | undefined;
  resolution: "captured" | "achieved" | "unachieved" | "voided";
  value: boolean | null;
  finality: DareFinalityV2;
  proof: DareProofV2 | null;
};

export class DareV2PartialSettlementError extends Error {
  readonly summaries: readonly DareV2SettlementSummary[];
  constructor(summaries: readonly DareV2SettlementSummary[], cause: unknown) {
    super("One or more Dare v2 contracts failed to settle", { cause });
    this.name = "DareV2PartialSettlementError";
    this.summaries = summaries;
  }
}
