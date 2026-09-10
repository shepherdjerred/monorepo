import { useQuery } from "@tanstack/react-query";
import { Loaded } from "@shepherdjerred/loaded";
import {
  Card,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { MatchScoreboards } from "#src/components/match/match-scoreboard.tsx";
import { MatchTimeline } from "#src/components/match/match-timeline.tsx";
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
  const value = Loaded.strict(Loaded.fromQuery(detail, ["explore.match"]));

  if (value.status === "loading") {
    return <PageShell>Loading match details…</PageShell>;
  }
  if (value.status === "error") {
    return (
      <PageShell>
        <Card>
          <CardHeader>
            <CardTitle>Match unavailable</CardTitle>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  const match = value.data.match;
  const participantIds = match.teams.flatMap((team) =>
    team.participants.map((participant) => participant.participantId),
  );
  return (
    <PageShell>
      <header>
        <p className="text-sm font-medium text-primary">Explore match</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {match.queue ?? `Queue ${match.queueId.toString()}`}
        </h1>
        <p className="mt-2 text-sm text-scout-subtle">
          {UTC_TIME.format(new Date(match.gameCreationMs))} UTC ·{" "}
          {duration(match.gameDurationSeconds)} · Patch {match.gameVersion} ·
          Map {match.mapId.toString()}
        </p>
      </header>
      <section className="space-y-3">
        <div>
          <h2 className="text-2xl font-semibold">Team scoreboards</h2>
          <p className="text-sm text-scout-subtle">
            This neutral Explore view contains no guild aliases or
            selected-player state.
          </p>
        </div>
        <MatchScoreboards teams={match.teams} />
      </section>
      <MatchTimeline
        source={{ kind: "explore" }}
        matchId={matchId}
        coverage={value.data.timeline.coverage}
        keyEvents={value.data.timeline.keyEvents}
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
