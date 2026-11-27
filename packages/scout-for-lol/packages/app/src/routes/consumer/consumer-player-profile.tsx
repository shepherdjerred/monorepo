import { Loaded } from "@shepherdjerred/loaded";
import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import {
  FriendlyPageLoading,
  FriendlyPageUnavailable,
} from "#src/components/friendly-page.tsx";
import { ProfileView } from "#src/components/player-profile/profile-view.tsx";
import { track } from "#src/lib/analytics.ts";
import {
  feedRows,
  playerHistoryInput,
  splitClimb,
} from "#src/lib/player/player-feed.ts";
import { playerSummaryInput } from "#src/lib/player/player-page.ts";
import { usePlayerPageUrlState } from "#src/lib/player/use-player-page-url-state.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { useConsumerPlayerParams } from "#src/lib/routes/route-params.ts";

/**
 * One player in the viewer's servers. Keyed by player so a different player
 * never shows the last one's page while it loads.
 */
export function ConsumerPlayerProfile() {
  const { playerId } = useConsumerPlayerParams();
  return <ConsumerPlayerProfileContent key={playerId} />;
}

function ConsumerPlayerProfileContent() {
  const { playerId } = useConsumerPlayerParams();
  const { filters, setFilters } = usePlayerPageUrlState();
  const trpc = useTRPC();
  const keep = { placeholderData: keepPreviousData };
  const summaryQuery = useQuery(
    trpc.consumerPlayer.profileSummary.queryOptions(
      playerSummaryInput(playerId, filters),
      keep,
    ),
  );
  const historyQuery = useQuery(
    trpc.consumerPlayer.matchHistory.queryOptions(
      playerHistoryInput(playerId, filters),
      keep,
    ),
  );
  const rankQuery = useQuery(
    trpc.consumerPlayer.rankHistory.queryOptions({ playerId }, keep),
  );
  // Challenge runs are a fold at the foot of the page: they appear when they
  // arrive, and a failure leaves the fold out.
  const challengesQuery = useQuery(
    trpc.challenge.profileRunsByPlayerId.queryOptions(
      { playerId },
      { retry: false },
    ),
  );
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || (!summaryQuery.isSuccess && !summaryQuery.isError)) {
      return;
    }
    opened.current = true;
    track("player_profile_opened", {
      outcome: summaryQuery.isSuccess ? "succeeded" : "failed",
      surface: "direct_link",
    });
  }, [summaryQuery.isError, summaryQuery.isSuccess]);

  // Every read here is scoped to the viewer's currently enabled shared
  // servers, so a failed refetch is the access recheck. `strict` drops the
  // retained page instead of showing one that outlived the permission behind it.
  const summary = Loaded.strict(Loaded.fromQuery(summaryQuery, ["summary"]));
  const history = Loaded.strict(Loaded.fromQuery(historyQuery, ["history"]));
  const ranks = Loaded.strict(Loaded.fromQuery(rankQuery, ["rankHistory"]));
  if (summary.status === "error") {
    return (
      <FriendlyPageUnavailable
        id="player-unavailable"
        title="Player unavailable"
        lead="This player could not be loaded."
        onRetry={() => {
          void summaryQuery.refetch();
          void historyQuery.refetch();
          void rankQuery.refetch();
        }}
        also={
          <Link to="/players" className={chipVariants({ variant: "ghost" })}>
            Players
          </Link>
        }
      />
    );
  }
  // The page appears once, whole: the games and the climb would otherwise pop
  // in below it and push the page around after the reader has started on it.
  if (
    summary.status === "loading" ||
    history.status === "loading" ||
    ranks.status === "loading"
  ) {
    return <FriendlyPageLoading />;
  }
  const nowMs = Date.now();
  const climb = ranks.status === "done" ? splitClimb(ranks.data) : null;
  return (
    <ProfileView
      playerId={playerId}
      summary={summary.data}
      filters={filters}
      onFilters={(next, kind) => {
        setFilters(next);
        track("player_profile_filter_changed", {
          kind,
          action: next.queues === undefined ? "all" : "explicit_selection",
        });
      }}
      feed={
        history.status === "done" ? feedRows(history.data.entries, nowMs) : []
      }
      feedFailed={
        history.status === "error"
          ? {
              onRetry: () => {
                void historyQuery.refetch();
              },
            }
          : undefined
      }
      split={
        ranks.status === "error"
          ? {
              kind: "failed",
              onRetry: () => {
                void rankQuery.refetch();
              },
            }
          : climb === null
            ? { kind: "none" }
            : { kind: "climb", climb }
      }
      challenges={challengesQuery.data ?? []}
      nowMs={nowMs}
    />
  );
}
