import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { MediaAutomationContext } from "./context.ts";
import { queueOperation, serializable } from "./store.ts";
import { observeRequesterWatch, queueRetentionCheck } from "./watch.ts";
import { sweepDownloads } from "./reconciliation/downloads.ts";
import { sweepFeeds } from "./reconciliation/feeds.ts";
import { sweepInventory } from "./reconciliation/inventory.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { queueMediaSubtitleTargets } from "./subtitles/queue.ts";
import { defaultIntent } from "#shared/editions/scope.ts";
import {
  MOVIE_WATCH_CURSOR,
  sweepMovieWatch,
} from "./reconciliation/movie-watch.ts";

/** Each page is bounded and cursor order is stable under concurrent inserts. */
export function createSweepActivities(
  context: MediaAutomationContext,
): Pick<MediaNetworkActivities, "sweepMediaWork"> {
  return {
    async sweepMediaWork(input) {
      if (
        input.kind === "watch" &&
        input.cursor?.startsWith(MOVIE_WATCH_CURSOR) === true
      )
        return sweepMovieWatch(context, input.cursor);
      if (input.kind === "downloads")
        return sweepDownloads(context, input.cursor);
      if (input.kind === "feeds")
        return sweepFeeds(context, input.cursor, input.sweepId);
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
      intents: { some: { edition: "default" } },
    },
    orderBy: { id: "asc" },
    take: 50,
    include: { intents: { where: { edition: "default" } } },
  });
  for (const item of media) {
    const intent = defaultIntent(item.intents);
    if (intent === null) throw new Error("Sweep item lost default target");
    if (input.kind === "watch") {
      if (
        intent.availability !== "available" &&
        intent.availability !== "quarantined"
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
    nextCursor:
      media.length === 50
        ? (media.at(-1)?.id ?? null)
        : input.kind === "watch"
          ? `${MOVIE_WATCH_CURSOR}start`
          : null,
  };
}

async function queueDue(
  context: MediaAutomationContext,
  item: Prisma.MediaItemGetPayload<{ include: { intents: true } }>,
) {
  const intent = defaultIntent(item.intents);
  if (intent === null) throw new Error("Sweep item lost desired state");
  if (!intent.desiredPresence) return;
  await serializable(context.db, (tx) =>
    queueMediaSubtitleTargets(tx, item.id),
  );
  if (!intent.monitoring) return;
  if (item.airDate !== null && item.airDate.getTime() > Date.now()) return;
  await serializable(context.db, async (tx) => {
    await queueOperation(tx, {
      key: `due:${item.id}:${String(Math.floor(Date.now() / 21_600_000))}`,
      kind: item.kind === "series" ? "refresh_catalog" : "reconcile_media",
      targetId: item.id,
      payload: {
        mediaId: item.id,
        generation: intent.generation,
        cursor: null,
      },
    });
  });
}
