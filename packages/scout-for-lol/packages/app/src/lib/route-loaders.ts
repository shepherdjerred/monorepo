import type { LoaderFunctionArgs } from "react-router";
import { CompetitionIdSchema, ReportIdSchema } from "@scout-for-lol/data";
import { queryClient } from "#src/lib/query-client.ts";
import { trpcOptions } from "#src/lib/trpc-options.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";

/**
 * Data-router loaders. Every loader is **non-blocking**: it kicks off a
 * background prefetch through the shared {@link queryClient} and returns `null`
 * immediately. It never `ensureQueryData`s — loaders run before the session
 * check, and a throwing loader would break the login redirect. The prefetch
 * only warms the cache; the component's own `useQuery`/`useSuspenseQuery` still
 * owns loading and error state.
 *
 * Prefetch inputs and options mirror each component's query exactly so the
 * loader and the component key against the same cache entry (and share
 * staleTime where it affects caching).
 */

export function requireSessionLoader(): null {
  void queryClient.prefetchQuery(
    trpcOptions.auth.sessionState.queryOptions(undefined, { retry: false }),
  );
  void queryClient.prefetchQuery(
    trpcOptions.guild.listManageable.queryOptions(undefined, {
      staleTime: STALE_TIME_SLOW_LIST,
    }),
  );
  return null;
}

export function guildLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void queryClient.prefetchQuery(
    trpcOptions.guild.listChannels.queryOptions(
      { guildId },
      { staleTime: STALE_TIME_SLOW_LIST },
    ),
  );
  return null;
}

export function subscriptionsLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void queryClient.prefetchInfiniteQuery(
    trpcOptions.subscription.list.infiniteQueryOptions(
      { guildId, limit: 50 },
      { getNextPageParam: (lastPage) => lastPage.nextCursor },
    ),
  );
  return null;
}

export function playersLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void queryClient.prefetchInfiniteQuery(
    trpcOptions.player.listPlayers.infiniteQueryOptions(
      { guildId, limit: 50 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        staleTime: STALE_TIME_SLOW_LIST,
      },
    ),
  );
  return null;
}

export function playerDetailLoader({ params }: LoaderFunctionArgs): null {
  const { guildId, alias } = params;
  if (guildId === undefined || alias === undefined) return null;
  void queryClient.prefetchQuery(
    trpcOptions.player.getPlayer.queryOptions({ guildId, alias }),
  );
  return null;
}

export function competitionsLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void queryClient.prefetchInfiniteQuery(
    trpcOptions.competition.list.infiniteQueryOptions(
      { guildId, activeOnly: true, limit: 50 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        staleTime: STALE_TIME_SLOW_LIST,
      },
    ),
  );
  return null;
}

export function competitionDetailLoader({ params }: LoaderFunctionArgs): null {
  const { guildId, competitionId } = params;
  if (guildId === undefined || competitionId === undefined) return null;
  const parsed = CompetitionIdSchema.safeParse(Number(competitionId));
  if (!parsed.success) return null;
  void queryClient.prefetchQuery(
    trpcOptions.competition.get.queryOptions({
      guildId,
      competitionId: parsed.data,
    }),
  );
  return null;
}

export function reportsLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void queryClient.prefetchQuery(
    trpcOptions.report.list.queryOptions(
      { guildId },
      { staleTime: STALE_TIME_SLOW_LIST },
    ),
  );
  return null;
}

export function reportDetailLoader({ params }: LoaderFunctionArgs): null {
  const { guildId, reportId } = params;
  if (guildId === undefined || reportId === undefined) return null;
  const parsed = ReportIdSchema.safeParse(Number(reportId));
  if (!parsed.success) return null;
  void queryClient.prefetchQuery(
    trpcOptions.report.get.queryOptions({ guildId, reportId: parsed.data }),
  );
  return null;
}

export function auditLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void queryClient.prefetchInfiniteQuery(
    trpcOptions.subscription.listAuditLog.infiniteQueryOptions(
      { guildId, limit: 50 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        staleTime: STALE_TIME_SLOW_LIST,
      },
    ),
  );
  return null;
}

export function accessLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void queryClient.prefetchQuery(
    trpcOptions.roles.list.queryOptions(
      { guildId },
      { staleTime: STALE_TIME_SLOW_LIST },
    ),
  );
  return null;
}
