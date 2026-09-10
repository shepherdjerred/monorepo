import { Link } from "react-router";
import type {
  ExploreMatchCard,
  ExploreMatchSnapshot,
} from "@scout-for-lol/data";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@scout-for-lol/design-system/components/card";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ChampionIcon } from "#src/components/match/champion-icon.tsx";
import { MatchObjectivesSummary } from "#src/components/match/match-objectives-summary.tsx";
import { formatRiotId } from "#src/lib/format/riot-id-format.ts";

const UTC_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function duration(seconds: number): string {
  return `${Math.floor(seconds / 60).toString()}m ${(seconds % 60).toString()}s`;
}

function matchLabel(match: ExploreMatchSnapshot): string {
  return match.queue ?? `Queue ${match.queueId.toString()}`;
}

function teamScore(match: ExploreMatchSnapshot): string {
  return match.teams.map((team) => team.kills.toLocaleString()).join(" – ");
}

function TeamChampions(props: {
  team: ExploreMatchSnapshot["teams"][number];
  decorative?: boolean | undefined;
}) {
  return (
    <div
      className="flex flex-wrap gap-1"
      aria-label={`Team ${props.team.teamId.toString()} champions`}
    >
      {props.team.participants.map((participant) => (
        <ChampionIcon
          key={participant.participantId}
          championName={participant.championName}
          {...(props.decorative === undefined
            ? {}
            : { decorative: props.decorative })}
          className="size-7"
        />
      ))}
    </div>
  );
}

function MatchHeader(props: { match: ExploreMatchSnapshot }) {
  const { match } = props;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
      <p className="font-medium text-scout-ink">{matchLabel(match)}</p>
      <p className="text-xs text-scout-subtle">
        {UTC_TIME.format(new Date(match.gameCreationMs))} UTC ·{" "}
        {duration(match.gameDurationSeconds)}
      </p>
    </div>
  );
}

function CompactMatchCard(props: { card: ExploreMatchCard }) {
  const { match } = props.card;
  return (
    <Card className="border-scout-border bg-scout-surface">
      <CardContent className="flex flex-wrap items-center gap-3 p-3">
        <MatchHeader match={match} />
        <div className="text-sm font-semibold tabular-nums text-scout-ink">
          {teamScore(match)}
        </div>
        <div className="flex flex-wrap gap-2">
          {match.teams.map((team) => (
            <TeamChampions key={team.teamId} team={team} decorative />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MediumMatchCard(props: { card: ExploreMatchCard }) {
  const { match } = props.card;
  return (
    <Card className="border-scout-border bg-scout-surface">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <MatchHeader match={match} />
          <div className="text-lg font-semibold tabular-nums text-scout-ink">
            {teamScore(match)}
          </div>
        </div>
        <p className="text-xs text-scout-subtle">
          Patch {match.gameVersion} · Map {match.mapId.toString()} ·{" "}
          {match.matchId}
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
        {match.teams.map((team) => (
          <section
            key={team.teamId}
            className="space-y-2 rounded-md border border-scout-border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Team {team.teamId.toString()}
              </p>
              <Badge variant={team.win ? "default" : "outline"}>
                {team.win ? "Victory" : "Defeat"} ·{" "}
                {team.kills.toLocaleString()} kills
              </Badge>
            </div>
            <TeamChampions team={team} />
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function LargeMatchCard(props: { card: ExploreMatchCard }) {
  const { match } = props.card;
  return (
    <Card className="border-scout-border bg-scout-surface">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <MatchHeader match={match} />
          <div className="text-xl font-semibold tabular-nums text-scout-ink">
            {teamScore(match)}
          </div>
        </div>
        <p className="text-xs text-scout-subtle">
          Patch {match.gameVersion} · Map {match.mapId.toString()} ·{" "}
          {match.matchId}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {match.teams.map((team) => (
            <section
              key={team.teamId}
              className="space-y-3 rounded-md border border-scout-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="font-medium">Team {team.teamId.toString()}</p>
                  <Badge variant={team.win ? "default" : "outline"}>
                    {team.win ? "Victory" : "Defeat"}
                  </Badge>
                </div>
                <p className="text-sm font-semibold tabular-nums">
                  {team.kills.toLocaleString()} kills
                </p>
              </div>
              <ul className="space-y-2">
                {team.participants.map((participant) => (
                  <li
                    key={participant.participantId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <ChampionIcon
                      championName={participant.championName}
                      decorative
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {formatRiotId(participant.riotId, "Unknown Riot ID")}
                    </span>
                    <span className="tabular-nums text-scout-subtle">
                      {participant.kills.toString()} /{" "}
                      {participant.deaths.toString()} /{" "}
                      {participant.assists.toString()}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-scout-subtle">
                <MatchObjectivesSummary objectives={team.objectives} />
              </p>
            </section>
          ))}
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={`/explore/matches/${encodeURIComponent(match.matchId)}`}>
            View match details
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ExploreMatchCard(props: { card: ExploreMatchCard }) {
  switch (props.card.size) {
    case "S": {
      return <CompactMatchCard card={props.card} />;
    }
    case "M": {
      return <MediumMatchCard card={props.card} />;
    }
    case "L": {
      return <LargeMatchCard card={props.card} />;
    }
  }
}

export function ExploreMatchCards(props: { cards: ExploreMatchCard[] }) {
  if (props.cards.length === 0) return null;
  return (
    <div className="space-y-3" aria-label="Match cards">
      {props.cards.map((card) => (
        <ExploreMatchCard key={card.match.matchId} card={card} />
      ))}
    </div>
  );
}
