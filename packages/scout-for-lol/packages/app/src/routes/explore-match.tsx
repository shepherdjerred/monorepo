import { useQuery } from "@tanstack/react-query";
import { Loaded } from "@shepherdjerred/loaded";
import {
  Card,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { MatchReview } from "#src/components/match/match-review.tsx";
import {
  matchQueueLabel,
  supportsReviewMap,
} from "#src/lib/player/match-review.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import { MatchMvpTally } from "#src/components/match/match-mvp-tally.tsx";
import { useExploreMatchParams } from "#src/lib/routes/route-params.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

function duration(seconds: number): string {
  return `${Math.floor(seconds / 60).toString()}m ${(seconds % 60).toString()}s`;
}

const UTC_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function ExploreMatch() {
  const { matchId } = useExploreMatchParams();
  const trpc = useTRPC();
  const detail = useQuery(trpc.exploreMatch.detail.queryOptions({ matchId }));
  const tally = useQuery(trpc.mvpVotes.matchTally.queryOptions({ matchId }));
  const value = Loaded.strict(Loaded.fromQuery(detail, ["explore.match"]));
  // Same 403/refetch rule as the detail query: a failed reauthorization must
  // not keep rendering guild aliases and justifications from the last success.
  const tallyValue = Loaded.strict(
    Loaded.fromQuery(tally, ["mvpVotes.matchTally"]),
  );

  if (value.status === "loading") {
    return <PageShell>Loading match details…</PageShell>;
  }
  if (value.status === "error") {
    return (
      <PageShell>
        <Card>
          <CardHeader>
            <CardTitle>Match unavailable</CardTitle>
            <Button onClick={() => void detail.refetch()}>Retry</Button>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  const match = value.data.match;
  return (
    <PageShell>
      <header>
        <p className="text-sm font-medium text-primary">Explore match</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {matchQueueLabel(match.queue)}
        </h1>
        <p className="mt-2 text-sm text-scout-subtle">
          {UTC_TIME.format(new Date(match.gameCreationMs))} UTC ·{" "}
          {duration(match.gameDurationSeconds)} · Patch {match.gameVersion} ·
          {match.mapId === 11
            ? "Summoner’s Rift"
            : match.mapId === 12
              ? "Howling Abyss"
              : ""}
        </p>
      </header>
      <MatchReview
        source={{ kind: "explore" }}
        matchId={matchId}
        teams={match.teams}
        showRiftMap={supportsReviewMap(match)}
        durationSeconds={match.gameDurationSeconds}
        matchups={match.roleMatchups}
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
