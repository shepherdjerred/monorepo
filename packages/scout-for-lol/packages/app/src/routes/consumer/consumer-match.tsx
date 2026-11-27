import { Loaded } from "@shepherdjerred/loaded";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Chip,
  chipVariants,
} from "@scout-for-lol/design-system/components/surfaces/chip";
import {
  PageLoading,
  PageState,
} from "@scout-for-lol/design-system/domain/profile/page-states";
import {
  MatchPage,
  type StoryState,
} from "#src/components/match-story/match-page.tsx";
import { track } from "#src/lib/analytics.ts";
import { PROTECTED_QUERY_OPTIONS } from "#src/lib/query/protected-query-options.ts";
import { useConsumerMatchParams } from "#src/lib/routes/route-params.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

export function ConsumerMatch() {
  const { playerId, matchId } = useConsumerMatchParams();
  const [searchParams] = useSearchParams();
  const profileParams = new URLSearchParams(searchParams);
  profileParams.delete("view");
  const profilePath = `/players/${playerId.toString()}?${profileParams.toString()}`;
  const trpc = useTRPC();
  const detail = useQuery(
    trpc.consumerMatch.detail.queryOptions(
      { playerId, matchId },
      PROTECTED_QUERY_OPTIONS,
    ),
  );
  // `strict` because this query carries authorization: without it a revoked
  // access whose refetch 403s would come back as `degraded` over the retained
  // cache and keep rendering protected data.
  const detailValue = Loaded.strict(
    Loaded.fromQuery(detail, ["consumer.match"]),
  );
  // The story is a second lake read, so it starts once the page can paint.
  const story = useQuery(
    trpc.consumerMatch.story.queryOptions(
      { playerId, matchId },
      {
        ...PROTECTED_QUERY_OPTIONS,
        enabled: detail.isSuccess,
      },
    ),
  );
  const storyValue = Loaded.strict(
    Loaded.fromQuery(story, ["consumer.matchStory"]),
  );
  const tracked = useRef(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (tracked.current || (!detail.isSuccess && !detail.isError)) return;
    tracked.current = true;
    track("match_detail_opened", {
      outcome: detail.isSuccess ? "succeeded" : "failed",
    });
    if (detail.isSuccess) {
      track("match_timeline_viewed", {
        outcome:
          detail.data.timeline.coverage === null ? "not_captured" : "available",
      });
    }
  }, [detail.data, detail.isError, detail.isSuccess]);

  if (detailValue.status === "loading") {
    return (
      <PageShell>
        <PageLoading label="Loading the match" />
      </PageShell>
    );
  }
  if (detailValue.status === "error") {
    return (
      <PageShell>
        <PageState
          id="match-unavailable"
          kind="unavailable"
          level={1}
          title="Match unavailable"
          lead="This match could not be loaded."
          actions={
            <>
              <Chip type="button" onClick={() => void detail.refetch()}>
                Retry
              </Chip>
              <Link
                to={profilePath}
                className={chipVariants({ variant: "ghost" })}
              >
                Back to profile
              </Link>
            </>
          }
        />
      </PageShell>
    );
  }

  const storyState: StoryState =
    storyValue.status === "done"
      ? { status: "done", story: storyValue.data }
      : storyValue.status === "error"
        ? { status: "error", retry: () => void story.refetch() }
        : { status: "loading" };
  return (
    <MatchPage
      detail={detailValue.data}
      story={storyState}
      profilePath={profilePath}
      now={now}
    />
  );
}

function PageShell(props: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8 sm:py-12">
      {props.children}
    </div>
  );
}
