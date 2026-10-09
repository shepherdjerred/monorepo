import { type DiscordGuildId, DiscordGuildIdSchema } from "@scout-for-lol/data";
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ConsumerGuildTeamTools } from "#src/components/player/consumer-guild-team-tools.tsx";
import { useTRPC, type RouterOutputs } from "#src/lib/query/trpc.ts";

type Overview = RouterOutputs["consumerGuild"]["overview"];
type CommunityTab = "people" | "teams" | "live";
type WindowDays = 30 | 90 | "all";
type QueuePreset = "standard" | "all" | "arena";

function MatchRelationList(props: {
  title: string;
  rows: Overview["insights"]["recentlyPlayedWith"];
  playerId: number;
}) {
  const rows = props.rows
    .filter((row) => row.playerId === props.playerId)
    .slice(0, 12);
  return (
    <div>
      <h4 className="font-medium">{props.title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-scout-subtle">
          No shared matches in this period. Try a longer time window.
        </p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap justify-between gap-2 rounded border p-2"
            >
              <span>
                {row.guildPlayerId === null ? (
                  row.name
                ) : (
                  <Link
                    className="hover:underline"
                    to={`/players/${row.guildPlayerId.toString()}`}
                  >
                    {row.name}
                  </Link>
                )}
                {row.guildPlayerId !== null && (
                  <span className="ml-1 text-xs text-scout-brand">
                    Guildmate
                  </span>
                )}
              </span>
              <span className="text-scout-subtle">
                {row.games.toString()} games · {row.wins.toString()}W ·{" "}
                <Link
                  className="hover:underline"
                  to={`/players/${props.playerId.toString()}/matches/${encodeURIComponent(row.lastMatchId)}`}
                >
                  last match
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PeopleTab(props: {
  overview: {
    players: Overview["players"];
    insights: Pick<
      Overview["insights"],
      "recentlyPlayedWith" | "rivalries" | "pairs"
    >;
  };
}) {
  const [playerId, setPlayerId] = useState<number | null>(null);
  const selected = playerId ?? props.overview.players[0]?.id;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="community-player" className="text-sm font-medium">
          Explore a guild player
        </label>
        <select
          id="community-player"
          className="block rounded border border-scout-border bg-scout-surface p-2 text-sm"
          value={selected ?? ""}
          onChange={(event) => {
            setPlayerId(Number(event.target.value));
          }}
        >
          {props.overview.players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.alias}
            </option>
          ))}
        </select>
      </div>
      {selected !== undefined && (
        <div className="grid gap-4 md:grid-cols-2">
          <MatchRelationList
            title="Recently played with"
            rows={props.overview.insights.recentlyPlayedWith}
            playerId={selected}
          />
          <MatchRelationList
            title="Rivalry records"
            rows={props.overview.insights.rivalries}
            playerId={selected}
          />
        </div>
      )}
      <p className="text-xs text-scout-subtle">
        Meetings are inferred from recorded match teams, not premade-party
        membership. Untracked opponents appear only after two meetings.
      </p>
      <div>
        <h4 className="font-medium">Teammate pairs · 3+ shared games</h4>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {props.overview.insights.pairs
            .filter((pair) => pair.games >= 3)
            .slice(0, 20)
            .map((pair) => {
              const first = props.overview.players.find(
                (player) => player.id === pair.firstId,
              );
              const second = props.overview.players.find(
                (player) => player.id === pair.secondId,
              );
              return (
                <p
                  key={`${pair.firstId.toString()}:${pair.secondId.toString()}`}
                  className="rounded border p-2 text-sm"
                >
                  {first?.alias ?? "Unknown"} + {second?.alias ?? "Unknown"} ·{" "}
                  {pair.wins.toString()}/{pair.games.toString()} wins
                </p>
              );
            })}
        </div>
        {props.overview.insights.pairs.every((pair) => pair.games < 3) && (
          <p className="text-sm text-scout-subtle">
            No pairs have three recorded shared games yet.
          </p>
        )}
      </div>
    </div>
  );
}

function LiveTab(props: { guildId: DiscordGuildId }) {
  const trpc = useTRPC();
  const live = useQuery(
    trpc.consumerGuild.live.queryOptions(
      { guildId: props.guildId },
      { staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    ),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-scout-subtle">
          Recently seen in game. Some games may have ended.
        </p>
        <Button variant="outline" onClick={() => void live.refetch()}>
          Refresh
        </Button>
      </div>
      {live.isPending || live.isFetching ? (
        <p className="text-sm text-scout-subtle">
          Checking recent observations…
        </p>
      ) : live.isError ? (
        <p className="text-sm text-scout-danger">
          Could not load observations.
        </p>
      ) : live.data.length === 0 ? (
        <p className="text-sm text-scout-subtle">
          No games seen recently in this server.
        </p>
      ) : (
        <ul className="space-y-2">
          {live.data.map((game) => (
            <li key={game.gameId} className="rounded border p-3 text-sm">
              <span className="font-medium">
                Detected {new Date(game.detectedAt).toLocaleString()}
              </span>
              <span className="ml-2 text-scout-subtle">
                (
                {Math.max(
                  0,
                  Math.round(
                    (Date.now() - new Date(game.detectedAt).getTime()) / 60_000,
                  ),
                ).toString()}{" "}
                minutes ago)
              </span>
              <p className="mt-1">
                {game.players.map((player) => player.alias).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadyCommunity(props: {
  guilds: RouterOutputs["consumerGuild"]["list"];
}) {
  const trpc = useTRPC();
  const [guildId, setGuildId] = useState<DiscordGuildId | null>(null);
  const [windowDays, setWindowDays] = useState<WindowDays>(90);
  const [queuePreset, setQueuePreset] = useState<QueuePreset>("standard");
  const [tab, setTab] = useState<CommunityTab>("people");
  const selectedGuild = guildId ?? props.guilds[0]?.id;
  const overview = useQuery(
    trpc.consumerGuild.overview.queryOptions(
      {
        guildId: selectedGuild ?? "",
        windowDays,
        queuePreset: tab === "teams" ? "standard" : queuePreset,
      },
      {
        enabled: selectedGuild !== undefined && tab !== "live",
        staleTime: 0,
        gcTime: 0,
        refetchOnMount: "always",
      },
    ),
  );
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          Server{" "}
          <select
            className="ml-1 rounded border border-scout-border bg-scout-surface p-1"
            value={selectedGuild}
            onChange={(event) => {
              setGuildId(DiscordGuildIdSchema.parse(event.target.value));
            }}
          >
            {props.guilds.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Window{" "}
          <select
            className="ml-1 rounded border border-scout-border bg-scout-surface p-1"
            value={windowDays}
            onChange={(event) => {
              setWindowDays(
                event.target.value === "all"
                  ? "all"
                  : event.target.value === "30"
                    ? 30
                    : 90,
              );
            }}
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value="all">All recorded</option>
          </select>
        </label>
        <label className="text-sm">
          Queues{" "}
          <select
            className="ml-1 rounded border border-scout-border bg-scout-surface p-1"
            value={queuePreset}
            onChange={(event) => {
              setQueuePreset(
                event.target.value === "arena"
                  ? "arena"
                  : event.target.value === "all"
                    ? "all"
                    : "standard",
              );
            }}
          >
            <option value="standard">Standard 5v5</option>
            <option value="arena">Arena</option>
            <option value="all">All queues</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2 border-b pb-2">
        {(["people", "teams", "live"] as const).map((value) => (
          <Button
            key={value}
            variant={tab === value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTab(value);
            }}
          >
            {value === "people"
              ? "People"
              : value === "teams"
                ? "Team tools"
                : "Recently detected"}
          </Button>
        ))}
      </div>
      {tab === "live" && selectedGuild !== undefined ? (
        <LiveTab guildId={selectedGuild} />
      ) : overview.isPending || overview.isFetching ? (
        <p className="text-sm text-scout-subtle">
          Loading recorded guild games…
        </p>
      ) : overview.isError ? (
        <p className="text-sm text-scout-danger">
          Could not load guild matches.{" "}
          <Button variant="outline" onClick={() => void overview.refetch()}>
            Retry
          </Button>
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-scout-subtle">
            {overview.data.insights.matchCount.toString()} recorded matches in
            this view.
          </p>
          {tab === "people" ? (
            <PeopleTab key={selectedGuild} overview={overview.data} />
          ) : (
            <ConsumerGuildTeamTools
              key={selectedGuild}
              overview={overview.data}
              windowDays={windowDays}
            />
          )}
        </div>
      )}
    </>
  );
}

export function ConsumerGuildCommunity() {
  const trpc = useTRPC();
  const guilds = useQuery(
    trpc.consumerGuild.list.queryOptions(undefined, {
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
    }),
  );
  let content: React.ReactNode;
  if (guilds.isPending || guilds.isFetching) {
    content = (
      <p className="text-sm text-scout-subtle">Checking guild access…</p>
    );
  } else if (guilds.isError) {
    content = (
      <p className="text-sm text-scout-danger">
        Could not check your server access.
      </p>
    );
  } else if (guilds.data.length === 0) {
    content = (
      <p className="text-sm text-scout-subtle">
        No shared servers have community stats enabled yet.
      </p>
    );
  } else {
    content = <ReadyCommunity guilds={guilds.data} />;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server community</CardTitle>
        <CardDescription>
          Recent games and standings in your servers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">{content}</CardContent>
    </Card>
  );
}
