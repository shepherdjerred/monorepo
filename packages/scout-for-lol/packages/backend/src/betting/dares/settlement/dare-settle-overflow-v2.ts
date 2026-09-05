import { BucksStorageOverflowError } from "#src/betting/ledger.ts";
import type { DareV2SettlementSummary } from "#src/betting/dares/settlement/dare-settle-types-v2.ts";
import {
  voidDareV2WithFullRefund,
  type RefundableDareV2Row,
} from "#src/betting/dares/settlement/dare-void-v2.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export async function settleDareV2OrVoidOnStorageOverflow(
  input: {
    dare: RefundableDareV2Row;
    prismaClient: ExtendedPrismaClient;
    now: Date;
    matchId?: string | undefined;
  },
  settle: () => Promise<DareV2SettlementSummary | undefined>,
): Promise<DareV2SettlementSummary | undefined> {
  try {
    return await settle();
  } catch (error) {
    if (!(error instanceof BucksStorageOverflowError)) throw error;
    const voided = await voidDareV2WithFullRefund(
      input.dare,
      "storage_overflow",
      input.prismaClient,
      input.now,
    );
    return voided
      ? {
          contractVersion: 2,
          dareId: input.dare.id,
          serverId: input.dare.serverId,
          channelId: input.dare.channelId,
          ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
          resolution: "voided",
          value: null,
          finality: { value: null, final: true, reason: "contract_error" },
          proof: null,
        }
      : undefined;
  }
}
