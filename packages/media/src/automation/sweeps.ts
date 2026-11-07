import {
  SERIES_PACK_NATIVE_TV_WATCH_CURSOR,
  sweepSeriesPackNativeTvWatchV1,
  hasSeriesPackNativeTvWatchTargetsV1,
  seriesPackNativeTvWatchDeferralsV1,
} from "./reconciliation/series-pack-native-watch.ts";
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
  LIBRARY_MOVIE_DUE_CURSOR,
  queueLibraryMovieDue,
  sweepLibraryMovieDue,
} from "./reconciliation/library-movies.ts";
import { movieManagementContext } from "./movie-editions/management-context.ts";
import {
  MOVIE_WATCH_CURSOR,
  sweepMovieWatch,
} from "./reconciliation/movie-watch.ts";
import {
  PERSONAL_MOVIE_DUE_CURSOR,
  sweepPersonalMovieDueV4,
} from "./reconciliation/personal-movie-due.ts";

/** Each page is bounded and cursor order is stable under concurrent inserts. */
export function createSweepActivities(
  context: MediaAutomationContext,
): Pick<MediaNetworkActivities, "sweepMediaWork"> {
  return {
    async sweepMediaWork(input) {
      const invocation = movieManagementContext(context);
      if (
        input.kind === "watch" &&
        input.cursor?.startsWith(SERIES_PACK_NATIVE_TV_WATCH_CURSOR) === true
      )
        return sweepSeriesPackNativeTvWatchV1(invocation, input.cursor);
      if (
        input.kind === "due" &&
        input.cursor?.startsWith(PERSONAL_MOVIE_DUE_CURSOR) === true
      )
        return sweepPersonalMovieDueV4(invocation, input.cursor);
      if (
        input.kind === "due" &&
        input.cursor?.startsWith(LIBRARY_MOVIE_DUE_CURSOR) === true
      )
        return sweepLibraryThenPersonalMovieDue(invocation, input.cursor);
      if (
        input.kind === "watch" &&
        input.cursor?.startsWith(MOVIE_WATCH_CURSOR) === true
      )
        return sweepMovieWatchWithNativeTail(invocation, input.cursor);
      if (input.kind === "downloads")
        return sweepDownloads(invocation, input.cursor);
      if (input.kind === "feeds")
        return sweepFeeds(context, input.cursor, input.sweepId);
      return input.kind === "inventory"
        ? sweepInventory(context, input.sweepId)
        : sweepIntentPage(invocation, {
            kind: input.kind,
            cursor: input.cursor,
          });
    },
  };
}

async function sweepMovieWatchWithNativeTail(
  context: MediaAutomationContext,
  cursor: string,
) {
  const page = await sweepMovieWatch(context, cursor);
  return page.nextCursor === null &&
    (await hasSeriesPackNativeTvWatchTargetsV1(context))
    ? { ...page, nextCursor: `${SERIES_PACK_NATIVE_TV_WATCH_CURSOR}start` }
    : page;
}

async function sweepLibraryThenPersonalMovieDue(
  context: MediaAutomationContext,
  cursor: string,
) {
  const page = await sweepLibraryMovieDue(context, cursor);
  return page.nextCursor === null
    ? { ...page, nextCursor: `${PERSONAL_MOVIE_DUE_CURSOR}start` }
    : page;
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
  const deferred =
    input.kind === "watch"
      ? await seriesPackNativeTvWatchDeferralsV1(
          context,
          media.map((item) => item.id),
        )
      : new Set<string>();
  for (const item of media) {
    const intent = defaultIntent(item.intents);
    if (intent === null) throw new Error("Sweep item lost default target");
    if (input.kind === "watch") {
      await sweepDefaultWatchItem(
        context,
        { id: item.id, availability: intent.availability },
        deferred,
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
          : `${LIBRARY_MOVIE_DUE_CURSOR}start`,
  };
}

async function sweepDefaultWatchItem(
  context: MediaAutomationContext,
  item: { id: string; availability: string },
  deferred: ReadonlySet<string>,
) {
  if (deferred.has(item.id)) return;
  if (item.availability !== "available" && item.availability !== "quarantined")
    return;
  await observeRequesterWatch(context, item.id);
  await queueRetentionCheck(
    context,
    item.id,
    String(Math.floor(Date.now() / 300_000)),
  );
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
  if (
    item.kind === "movie" &&
    (await queueLibraryMovieDue(context, {
      rootMediaId: item.id,
      mediaId: item.id,
      edition: "default",
    })) !== null
  )
    return;
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
