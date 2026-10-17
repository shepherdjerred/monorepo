import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { MediaAutomationContext } from "./context.ts";
import { queueOperation, serializable } from "./store.ts";
import { observeRequesterWatch, queueRetentionCheck } from "./watch.ts";
import { sweepDownloads } from "./reconciliation/downloads.ts";
import { sweepFeeds } from "./reconciliation/feeds.ts";
import { sweepInventory } from "./reconciliation/inventory.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { queueMediaSubtitleTargets } from "./subtitles/queue.ts";

/** Each page is bounded and cursor order is stable under concurrent inserts. */
export function createSweepActivities(
  context: MediaAutomationContext,
): Pick<MediaNetworkActivities, "sweepMediaWork"> {
  return {
    async sweepMediaWork(input) {
      if (input.kind === "downloads")
        return sweepDownloads(context, input.cursor);
      if (input.kind === "feeds") return sweepFeeds(context, input.cursor);
      return input.kind === "inventory"
        ? sweepInventory(context, input.sweepId)
        : sweepIntentPage(context, { kind: input.kind, cursor: input.cursor });
    },
  };
}

async function sweepIntentPage(
  context: MediaAutomationContext,
  input: { kind: "watch" | "due"; cursor: string | null },
) {
  const media = await context.db.mediaItem.findMany({
    where: {
      ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
      kind: {
        in:
          input.kind === "due"
            ? ["movie", "episode", "series"]
            : ["movie", "episode"],
      },
      intent: { isNot: null },
    },
    orderBy: { id: "asc" },
    take: 50,
    include: { intent: true },
  });
  for (const item of media) {
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
    } else {
      await queueDue(context, item);
    }
  }
  return {
    processed: media.length,
    nextCursor: media.length === 50 ? (media.at(-1)?.id ?? null) : null,
  };
}

async function queueDue(
  context: MediaAutomationContext,
  item: Prisma.MediaItemGetPayload<{ include: { intent: true } }>,
) {
  if (item.intent === null) throw new Error("Sweep item lost desired state");
  if (!item.intent.desiredPresence) return;
  await serializable(context.db, (tx) =>
    queueMediaSubtitleTargets(tx, item.id),
  );
  if (!item.intent.monitoring) return;
  if (item.airDate !== null && item.airDate.getTime() > Date.now()) return;
  await serializable(context.db, async (tx) => {
    await queueOperation(tx, {
      key: `due:${item.id}:${String(Math.floor(Date.now() / 21_600_000))}`,
      kind: item.kind === "series" ? "refresh_catalog" : "reconcile_media",
      targetId: item.id,
      payload: {
        mediaId: item.id,
        generation: item.intent?.generation,
        cursor: null,
      },
    });
  });
}
