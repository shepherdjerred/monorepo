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
import { artworkBackfillTurn } from "#domain/household/artwork-backfill.ts";
import { observeUntargetedRootArtwork } from "./reconciliation/root-artwork.ts";
import {
  MOVIE_WATCH_CURSOR,
  sweepMovieWatch,
} from "./reconciliation/movie-watch.ts";
import {
  PERSONAL_MOVIE_DUE_CURSOR,
  sweepPersonalMovieDueV4,
} from "./reconciliation/personal-movie-due.ts";

/** Rows in one default-target sweep page. */
const INTENT_PAGE_SIZE = 50;

/** The due sweep's cadence; its index names a period in every refresh key. */
const DUE_PERIOD_MS = 21_600_000;

function duePeriod(): number {
  return Math.floor(Date.now() / DUE_PERIOD_MS);
}

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
      // Every due sweep starts here exactly once, before any page: a root
      // without a default target is on no page, so paging cannot reach it.
      if (input.kind === "due" && input.cursor === null)
        await observeUntargetedRootArtwork(context, duePeriod());
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
    take: INTENT_PAGE_SIZE,
    include: { intents: { where: { edition: "default" } } },
  });
  const deferred =
    input.kind === "watch"
      ? await seriesPackNativeTvWatchDeferralsV1(
          context,
          media.map((item) => item.id),
        )
      : new Set<string>();
  const artwork =
    input.kind === "due"
      ? await artworkBackfillTitles(context, media)
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
      await queueDue(context, item, artwork);
    }
  }
  return {
    processed: media.length,
    nextCursor:
      media.length === INTENT_PAGE_SIZE
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
  artwork: ReadonlySet<string>,
) {
  const intent = defaultIntent(item.intents);
  if (intent === null) throw new Error("Sweep item lost desired state");
  const calendarQueued = await queueCalendarRefresh(
    context,
    item,
    intent.libraryKeep,
    artwork,
  );
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
  if (item.kind === "movie") {
    const demand = await context.db.mediaRequest.findFirst({
      where: {
        mediaId: item.id,
        edition: "default",
        active: true,
        direct: true,
        excluded: false,
        movieEditionChoiceId: { not: null },
      },
      select: { id: true },
    });
    const invocation = context.movieManagement;
    if (invocation === undefined)
      throw new Error("Default movie due work lost its original capability");
    invocation.budget.consume(demand === null ? 0 : 1);
    if (demand !== null) {
      // The personal tail processes one chosen target per Activity under its
      // original shared budget. This discovery page cannot fall through to
      // historical unscoped acquisition, including when the choice is blocked.
      return;
    }
  }
  await queueDueOperation(context, item, intent.generation, calendarQueued);
}

async function queueDueOperation(
  context: MediaAutomationContext,
  item: { id: string; kind: string },
  generation: number,
  calendarQueued: boolean,
) {
  if (calendarQueued && item.kind === "series") return;
  await serializable(context.db, async (tx) => {
    await queueOperation(tx, {
      key: `due:${item.id}:${String(duePeriod())}`,
      kind: item.kind === "series" ? "refresh_catalog" : "reconcile_media",
      targetId: item.id,
      payload: {
        mediaId: item.id,
        generation,
        cursor: null,
      },
    });
  });
}

/** A direct, active claim someone still follows keeps a title refreshed. */
const followingClaim = {
  direct: true,
  active: true,
  excluded: false,
  interestState: "following",
} as const;

/**
 * The owned titles on this page to refresh this period for artwork alone: a
 * movie or series nobody keeps or follows whose artwork has never been
 * observed. The refresh records the observation and the title stops matching,
 * which is the whole backfill. The page's candidates share a rotating budget;
 * see `artworkBackfillTurn` for why none of them can be starved.
 */
async function artworkBackfillTitles(
  context: MediaAutomationContext,
  page: readonly Prisma.MediaItemGetPayload<{ include: { intents: true } }>[],
): Promise<ReadonlySet<string>> {
  const unobserved = page.flatMap((item, slot) =>
    (item.kind === "movie" || item.kind === "series") &&
    item.tmdbId !== null &&
    item.artworkObservedAt === null &&
    defaultIntent(item.intents)?.libraryKeep === false
      ? [{ id: item.id, slot }]
      : [],
  );
  if (unobserved.length === 0) return new Set();
  const claims = await context.db.mediaRequest.findMany({
    where: {
      mediaId: { in: unobserved.map((item) => item.id) },
      ...followingClaim,
    },
    select: { mediaId: true },
    distinct: ["mediaId"],
  });
  const followed = new Set(claims.map((claim) => claim.mediaId));
  const candidates = unobserved.filter((item) => !followed.has(item.id));
  const turn = new Set(
    artworkBackfillTurn(
      candidates.map((item) => item.slot),
      INTENT_PAGE_SIZE,
      duePeriod(),
    ),
  );
  return new Set(
    candidates.filter((item) => turn.has(item.slot)).map((item) => item.id),
  );
}

/**
 * Public catalog dates, status and artwork are informational and do not require
 * file-write authority. A kept or followed title is refreshed every period; any
 * other title only on its artwork backfill turn.
 */
async function queueCalendarRefresh(
  context: MediaAutomationContext,
  item: { id: string; kind: string; tmdbId: number | null },
  libraryKeep: boolean,
  artwork: ReadonlySet<string>,
) {
  if ((item.kind !== "movie" && item.kind !== "series") || item.tmdbId === null)
    return false;
  const claim = libraryKeep
    ? null
    : await context.db.mediaRequest.findFirst({
        where: { mediaId: item.id, ...followingClaim },
        select: { id: true },
      });
  if (!libraryKeep && claim === null && !artwork.has(item.id)) return false;
  await serializable(context.db, (tx) =>
    queueOperation(tx, {
      key: `calendar:${item.id}:${String(duePeriod())}`,
      kind: "refresh_catalog",
      targetId: item.id,
      payload: { mediaId: item.id, cursor: null },
    }),
  );
  return true;
}
