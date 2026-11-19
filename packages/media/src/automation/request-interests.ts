import type { MediaAutomationContext } from "./context.ts";
import { reconcileRequestInterests } from "#infrastructure/request-interest/reconcile.ts";
import { refreshInterestNoticeReceipts } from "./notifications/interest-receipts.ts";

/** One bounded page per scheduled run; resume fairly through a durable cursor. */
export function createRequestInterestReconciler(
  context: MediaAutomationContext,
  serverMachineId: string,
) {
  return {
    async reconcile() {
      const checkpoint = await context.db.playbackCollector.upsert({
        where: { serverMachineId },
        create: { serverMachineId },
        update: {},
      });
      const result = await reconcileRequestInterests(context.db, {
        cursor: checkpoint.interestCursor,
        refreshNotice: (eventId) =>
          refreshInterestNoticeReceipts(context, eventId),
      });
      await context.db.playbackCollector.updateMany({
        where: {
          serverMachineId,
          interestCursor: checkpoint.interestCursor,
        },
        data: { interestCursor: result.nextCursor },
      });
      return result;
    },
  };
}
