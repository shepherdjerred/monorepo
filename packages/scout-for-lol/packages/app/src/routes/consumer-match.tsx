import { Loaded } from "@shepherdjerred/loaded";
import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { MatchScoreboards } from "#src/components/match-scoreboard.tsx";
import { MatchTimeline } from "#src/components/match-timeline.tsx";
import { track } from "#src/lib/analytics.ts";
import {
  parsePlayerProfileFilters,
  playerProfileSearch,
} from "#src/lib/player-profile-filters.ts";
import { useConsumerMatchParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

function duration(seconds: number): string {
  return `${Math.floor(seconds / 60).toString()}m ${(seconds % 60).toString()}s`;
}

export function ConsumerMatch() {
  const { playerId, matchId } = useConsumerMatchParams();
  const [searchParams] = useSearchParams();
  const profileSearch = playerProfileSearch(
    parsePlayerProfileFilters(searchParams),
  );
  const trpc = useTRPC();
  const detail = useQuery(
    trpc.consumerMatch.detail.queryOptions({ playerId, matchId }),
  );
  const tracked = useRef(false);
  const detailValue = Loaded.fromQuery(detail, ["consumer.match"]);

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
              The selected accessible Scout player did not participate in this
              match, or Scout could not reverify your current server access.
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
  const participantIds = match.teams.flatMap((team) =>
    team.participants.map((participant) => participant.participantId),
  );
  return (
    <PageShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Recorded match</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {match.queue ?? `Queue ${match.queueId.toString()}`}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-scout-subtle">
            <span>{new Date(match.gameCreationMs).toLocaleString()}</span>
            <span>·</span>
            <span>{duration(match.gameDurationSeconds)}</span>
            <span>·</span>
            <span>Patch {match.gameVersion}</span>
            <Badge variant="outline">Map {match.mapId.toString()}</Badge>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to={`/players/${playerId.toString()}${profileSearch}`}>
            Back to profile
          </Link>
        </Button>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-2xl font-semibold">Team scoreboards</h2>
          <p className="text-sm text-scout-subtle">
            All public Riot match participants are shown. Scout aliases appear
            only from your currently accessible guilds.
          </p>
        </div>
        <MatchScoreboards teams={match.teams} />
      </section>

      <MatchTimeline
        playerId={playerId}
        matchId={matchId}
        coverage={detailValue.data.timeline.coverage}
        keyEvents={detailValue.data.timeline.keyEvents}
        participantIds={participantIds}
      />
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
