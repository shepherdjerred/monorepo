import type { LoaderFunctionArgs } from "react-router";
import {
  CompetitionIdSchema,
  ExploreConversationIdSchema,
  PlayerIdSchema,
  ReportIdSchema,
} from "@scout-for-lol/data";
import { queryClient } from "#src/lib/api/query-client.ts";
import { trpcOptions } from "#src/lib/api/trpc-options.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/api/stale-times.ts";
import { SESSION_QUERY_OPTIONS } from "#src/lib/api/session-query.ts";

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

async function preloadQuery(query: Promise<unknown>): Promise<void> {
  try {
    await query;
  } catch {
    // Loaders only warm a cache. Their routes deliberately own error state.
    return;
  }
}

export function requireSessionLoader(): null {
  void preloadQuery(
    queryClient.query(
      trpcOptions.auth.sessionState.queryOptions(
        undefined,
        SESSION_QUERY_OPTIONS,
      ),
    ),
  );
  void preloadQuery(
    queryClient.query(
      trpcOptions.guild.listManageable.queryOptions(undefined, {
        staleTime: STALE_TIME_SLOW_LIST,
      }),
    ),
  );
  void preloadQuery(
    queryClient.query(trpcOptions.explore.status.queryOptions()),
  );
  void preloadQuery(
    queryClient.query(trpcOptions.consumerPlayer.status.queryOptions()),
  );
  void preloadQuery(queryClient.query(trpcOptions.bucks.status.queryOptions()));
  return null;
}

export function bucksLoader(): null {
  void preloadQuery(queryClient.query(trpcOptions.bucks.status.queryOptions()));
  return null;
}

export function consumerPlayersLoader(): null {
  void preloadQuery(
    queryClient.query(trpcOptions.consumerPlayer.status.queryOptions()),
  );
  void preloadQuery(
    queryClient.query(trpcOptions.consumerPlayer.home.queryOptions()),
  );
  return null;
}

export function consumerPlayerLoader({ params }: LoaderFunctionArgs): null {
  const parsed = PlayerIdSchema.safeParse(Number(params["playerId"]));
  if (!parsed.success) return null;
  void preloadQuery(
    queryClient.query(
      trpcOptions.consumerPlayer.status.queryOptions(undefined, {
        staleTime: 0,
      }),
    ),
  );
  return null;
}

export function guildLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void preloadQuery(
    queryClient.query(
      trpcOptions.guild.listChannels.queryOptions(
        { guildId },
        { staleTime: STALE_TIME_SLOW_LIST },
      ),
    ),
  );
  return null;
}

export function subscriptionsLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void preloadQuery(
    queryClient.infiniteQuery(
      trpcOptions.subscription.list.infiniteQueryOptions(
        { guildId, limit: 50 },
        { getNextPageParam: (lastPage) => lastPage.nextCursor },
      ),
    ),
  );
  return null;
}

export function playersLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void preloadQuery(
    queryClient.infiniteQuery(
      trpcOptions.player.listPlayers.infiniteQueryOptions(
        { guildId, limit: 50 },
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          staleTime: STALE_TIME_SLOW_LIST,
        },
      ),
    ),
  );
  return null;
}

export function playerDetailLoader({ params }: LoaderFunctionArgs): null {
  const { guildId, alias } = params;
  if (guildId === undefined || alias === undefined) return null;
  void preloadQuery(
    queryClient.query(
      trpcOptions.player.getPlayer.queryOptions({ guildId, alias }),
    ),
  );
  return null;
}

export function competitionsLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void preloadQuery(
    queryClient.infiniteQuery(
      trpcOptions.competition.list.infiniteQueryOptions(
        { guildId, activeOnly: true, limit: 50 },
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          staleTime: STALE_TIME_SLOW_LIST,
        },
      ),
    ),
  );
  return null;
}

export function competitionDetailLoader({ params }: LoaderFunctionArgs): null {
  const { guildId, competitionId } = params;
  if (guildId === undefined || competitionId === undefined) return null;
  const parsed = CompetitionIdSchema.safeParse(Number(competitionId));
  if (!parsed.success) return null;
  void preloadQuery(
    queryClient.query(
      trpcOptions.competition.get.queryOptions({
        guildId,
        competitionId: parsed.data,
      }),
    ),
  );
  return null;
}

export function reportsLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void preloadQuery(
    queryClient.query(
      trpcOptions.report.list.queryOptions(
        { guildId },
        { staleTime: STALE_TIME_SLOW_LIST },
      ),
    ),
  );
  return null;
}

export function reportDetailLoader({ params }: LoaderFunctionArgs): null {
  const { guildId, reportId } = params;
  if (guildId === undefined || reportId === undefined) return null;
  const parsed = ReportIdSchema.safeParse(Number(reportId));
  if (!parsed.success) return null;
  void preloadQuery(
    queryClient.query(
      trpcOptions.report.get.queryOptions({ guildId, reportId: parsed.data }),
    ),
  );
  return null;
}

export function exploreLoader({ params }: LoaderFunctionArgs): null {
  void preloadQuery(
    queryClient.query(trpcOptions.explore.status.queryOptions()),
  );
  void preloadQuery(queryClient.query(trpcOptions.explore.list.queryOptions()));
  const { conversationId } = params;
  if (conversationId === undefined) return null;
  const parsed = ExploreConversationIdSchema.safeParse(conversationId);
  if (!parsed.success) return null;
  void preloadQuery(
    queryClient.query(
      trpcOptions.explore.get.queryOptions({ conversationId: parsed.data }),
    ),
  );
  return null;
}

export function auditLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void preloadQuery(
    queryClient.infiniteQuery(
      trpcOptions.subscription.listAuditLog.infiniteQueryOptions(
        { guildId, limit: 50 },
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          staleTime: STALE_TIME_SLOW_LIST,
        },
      ),
    ),
  );
  return null;
}

export function accessLoader({ params }: LoaderFunctionArgs): null {
  const { guildId } = params;
  if (guildId === undefined) return null;
  void preloadQuery(
    queryClient.query(
      trpcOptions.roles.list.queryOptions(
        { guildId },
        { staleTime: STALE_TIME_SLOW_LIST },
      ),
    ),
  );
  return null;
}
