import type {
  DiscordGuildId,
  DiscordChannelId,
} from "@scout-for-lol/domain/identity/discord.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
export type DareFinality = {
  value: boolean | null;
  final: boolean;
  reason:
    | "monotone_success"
    | "monotone_failure"
    | "deadline"
    | "game_cap"
    | "game_sets_full"
    | "reversible"
    | "evidence_watermark"
    | "contract_error";
};

export type DareProof = {
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

export type DareSettlementSummary = {
  dareId: number;
  serverId: DiscordGuildId;
  channelId: DiscordChannelId;
  matchId?: RiotMatchId | undefined;
  resolution: "captured" | "achieved" | "unachieved" | "voided";
  value: boolean | null;
  finality: DareFinality;
  proof: DareProof | null;
};

export class DarePartialSettlementError extends Error {
  readonly summaries: readonly DareSettlementSummary[];
  constructor(summaries: readonly DareSettlementSummary[], cause: unknown) {
    super("One or more Dare contracts failed to settle", { cause });
    this.name = "DarePartialSettlementError";
    this.summaries = summaries;
  }
}
