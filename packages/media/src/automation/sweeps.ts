import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { MediaAutomationContext } from "./context.ts";
import { queueOperation, serializable } from "./store.ts";
import { observeRequesterWatch, queueRetentionCheck } from "./watch.ts";

/** Each page is bounded and cursor order is stable under concurrent inserts. */
export function createSweepActivities(
  context: MediaAutomationContext,
): Pick<MediaNetworkActivities, "sweepMediaWork"> {
  return {
    async sweepMediaWork(input) {
      assertImplementedSweep(input.kind);
      const media = await context.db.mediaItem.findMany({
        where: {
          ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
          kind: { in: ["movie", "episode"] },
          intent: { isNot: null },
        },
        orderBy: { id: "asc" },
        take: 50,
        include: { intent: true },
      });
      for (const item of media) {
        if (item.intent === null)
          throw new Error("Sweep item lost desired state");
        if (input.kind === "watch") {
          if (
            item.availability !== "available" &&
            item.availability !== "quarantined"
          )
            continue;
          await observeRequesterWatch(context, item.id);
          await queueRetentionCheck(
            context,
            item.id,
            String(Math.floor(Date.now() / 300_000)),
          );
        } else if (input.kind === "due") {
          if (!item.intent.monitoring || !item.intent.desiredPresence) continue;
          await serializable(context.db, async (tx) => {
            await queueOperation(tx, {
              key: `due:${item.id}:${String(Math.floor(Date.now() / 21_600_000))}`,
              kind: "reconcile_media",
              targetId: item.id,
              payload: {
                mediaId: item.id,
                generation: item.intent?.generation,
              },
            });
          });
        }
      }
      return {
        processed: media.length,
        nextCursor: media.length === 50 ? (media.at(-1)?.id ?? null) : null,
      };
    },
  };
}

function assertImplementedSweep(kind: string): void {
  if (kind === "feeds" || kind === "inventory" || kind === "downloads")
    throw new Error(
      `Media ${kind} sweep requires implementation before schedule activation`,
    );
}
