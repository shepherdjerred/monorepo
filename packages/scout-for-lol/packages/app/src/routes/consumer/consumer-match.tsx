import { Loaded } from "@shepherdjerred/loaded";
import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  matchQueueLabel,
  supportsReviewMap,
} from "#src/lib/player/match-review.ts";
import { ArenaSubteams } from "#src/components/match/match-arena-subteams.tsx";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { MatchReview } from "#src/components/match/match-review.tsx";
import { MatchMvpTally } from "#src/components/match/match-mvp-tally.tsx";
import { track } from "#src/lib/analytics.ts";
import { useConsumerMatchParams } from "#src/lib/routes/route-params.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

function duration(seconds: number): string {
  return `${Math.floor(seconds / 60).toString()}m ${(seconds % 60).toString()}s`;
}

export function ConsumerMatch() {
  const { playerId, matchId } = useConsumerMatchParams();
  const [searchParams] = useSearchParams();
  const profileParams = new URLSearchParams(searchParams);
  profileParams.delete("view");
  const profileSearch = `?${profileParams.toString()}`;
  const trpc = useTRPC();
  const detail = useQuery(
    trpc.consumerMatch.detail.queryOptions(
      { playerId, matchId },
      { staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    ),
  );
  const tally = useQuery(trpc.mvpVotes.matchTally.queryOptions({ matchId }));
  const tallyValue = Loaded.strict(
    Loaded.fromQuery(tally, ["mvpVotes.matchTally"]),
  );
  const tracked = useRef(false);
  // `strict` because this query carries authorization: the scoreboard and the
  // guild-scoped Scout aliases below are only visible through a shared guild.
  // Without it a revoked access whose refetch 403s would come back as
  // `degraded` over the retained cache and keep rendering protected data.
  const detailValue = Loaded.strict(
    Loaded.fromQuery(detail, ["consumer.match"]),
  );

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
        <p className="text-sm text-scout-subtle">Loading match details…</p>
      </PageShell>
    );
  }
  if (detailValue.status === "error") {
    return (
      <PageShell>
        <Card>
          <CardHeader>
            <CardTitle>Match unavailable</CardTitle>
            <CardDescription>
              This match is unavailable. Check your server access and try again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button onClick={() => void detail.refetch()}>Retry</Button>
            <Button asChild variant="outline">
              <Link to={`/players/${playerId.toString()}${profileSearch}`}>
                Back to profile
              </Link>
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const match = detailValue.data.match;
  return (
    <PageShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Recorded match</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {matchQueueLabel(match.queue)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-scout-subtle">
            <span>{new Date(match.gameCreationMs).toLocaleString()}</span>
            <span>·</span>
            <span>{duration(match.gameDurationSeconds)}</span>
            <span>·</span>
            <span>Patch {match.gameVersion}</span>
            {match.mapId === 11 && <span>Summoner’s Rift</span>}
            {match.mapId === 12 && <span>Howling Abyss</span>}
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to={`/players/${playerId.toString()}${profileSearch}`}>
            Back to profile
          </Link>
        </Button>
      </div>

      <MatchReview
        source={{ kind: "consumer", playerId }}
        matchId={matchId}
        teams={match.teams}
        showRiftMap={supportsReviewMap(match)}
        durationSeconds={match.gameDurationSeconds}
        matchups={match.roleMatchups}
        arena={
          match.arenaSubteams !== null && match.arenaSubteams.length > 0 ? (
            <ArenaSubteams subteams={match.arenaSubteams} />
          ) : undefined
        }
      >
        {tallyValue.status === "done" && tallyValue.data !== null && (
          <MatchMvpTally tally={tallyValue.data} />
        )}
      </MatchReview>
    </PageShell>
  );
}

function PageShell(props: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl space-y-7 px-6 py-8 sm:px-8 sm:py-12">
      {props.children}
    </div>
  );
}
