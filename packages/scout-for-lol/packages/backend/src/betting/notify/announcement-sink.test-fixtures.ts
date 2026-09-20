import {
  announcingSettlementSink,
  SettlementCheckpointError,
  type SettlementAnnouncementSink,
} from "#src/betting/notify/announcement-sink.ts";
import { recordSettlementAnnouncementItem } from "#src/database/durable/settlement-announcement-repository.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { Db } from "#src/database/index.ts";

/**
 * The sinks every producing family's checkpoint tests need.
 *
 * Each family — closures, market settlements, parlays, earnings, Dares —
 * has to answer the same two questions about its own transaction, so each
 * was building the same two sinks by hand. Shared so the next family's tests
 * cost a line rather than a block, and so the question they ask stays
 * identical across families.
 */

/**
 * Fails the checkpoint the way production does: with the typed error, which
 * is the one every broad handler between the producer and the Activity has
 * been taught to rethrow.
 */
export function checkpointFailingSink(): SettlementAnnouncementSink {
  return {
    ...announcingSettlementSink,
    recordAnnouncementItem: (_handle, item) =>
      Promise.reject(
        new SettlementCheckpointError({
          family: item.family,
          itemKey: item.itemKey,
          retryable: true,
          message: "the checkpoint row could not be written",
          cause: new Error("connection reset"),
        }),
      ),
  };
}

/**
 * Records for real through whatever handle the producer passes, then
 * optionally fails.
 *
 * The failing variant is how transactionality is proved by BEHAVIOUR: the
 * row is written and the producing transaction then aborts, so a row written
 * through the ambient client would survive and one written through the
 * transaction's handle cannot.
 */
export function checkpointRecordingSink(
  matchId: string,
  options: { thenThrow?: string } = {},
): SettlementAnnouncementSink {
  return {
    ...announcingSettlementSink,
    recordAnnouncementItem: async (handle: Db, item) => {
      await recordSettlementAnnouncementItem(handle, {
        matchId: RiotMatchIdSchema.parse(matchId),
        item,
      });
      if (options.thenThrow !== undefined) throw new Error(options.thenThrow);
    },
  };
}
