import { BucksStorageOverflowError } from "#src/betting/ledger.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settle-types.ts";
import {
  voidDareWithFullRefund,
  type RefundableDareRow,
} from "#src/betting/dares/settlement/dare-void.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { DareNotificationDisposition } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";

export async function settleDareOrVoidOnStorageOverflow(
  input: {
    dare: RefundableDareRow;
    prismaClient: ExtendedPrismaClient;
    now: Date;
    matchId?: string | undefined;
    /** Whether the match this settles is owed a public delivery. */
    notify: DareNotificationDisposition;
  },
  settle: () => Promise<DareSettlementSummary | undefined>,
): Promise<DareSettlementSummary | undefined> {
  try {
    return await settle();
  } catch (error) {
    if (!(error instanceof BucksStorageOverflowError)) throw error;
    const voided = await voidDareWithFullRefund(
      input.dare,
      "storage_overflow",
      input.prismaClient,
      { now: input.now, notify: input.notify },
    );
    return voided
      ? {
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
