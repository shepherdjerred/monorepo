import type { DiscordGuildId } from "@scout-for-lol/data";
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { useTRPC } from "#src/lib/query/trpc.ts";

export function ConsumerPlayerCommunity(props: {
  guildId: DiscordGuildId;
  playerId: number;
}) {
  const [windowDays, setWindowDays] = useState<30 | 90 | "all">(90);
  const [queuePreset, setQueuePreset] = useState<"standard" | "all" | "arena">(
    "standard",
  );
  const trpc = useTRPC();
  const overview = useQuery(
    trpc.consumerGuild.overview.queryOptions(
      { guildId: props.guildId, windowDays, queuePreset },
      { staleTime: 0, gcTime: 0, refetchOnMount: "always" },
    ),
  );
  const insights = overview.data?.insights;
  const accounts =
    insights?.accountForms.filter(
      (account) => account.playerId === props.playerId,
    ) ?? [];
  const together =
    insights?.recentlyPlayedWith
      .filter((relation) => relation.playerId === props.playerId)
      .slice(0, 8) ?? [];
  const rivals =
    insights?.rivalries
      .filter((relation) => relation.playerId === props.playerId)
      .slice(0, 8) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Community connections</CardTitle>
        <CardDescription>
          Teammates and opponents from this server’s recorded matches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 text-sm">
          <label>
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
          <label>
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
        {overview.isPending || overview.isFetching ? (
          <p className="text-sm text-scout-subtle">
            Loading community history…
          </p>
        ) : overview.isError ? (
          <p className="text-sm text-scout-danger">
            Community history unavailable.
          </p>
        ) : (
          <>
            <div>
              <h4 className="font-medium">Account performance</h4>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {accounts.map((account) => (
                  <p
                    key={account.accountId}
                    className="rounded border p-2 text-sm"
                  >
                    <span className="font-medium">{account.riotId}</span> ·{" "}
                    {account.region}
                    {account.isMain ? " · most played" : ""}
                    <span className="block text-scout-subtle">
                      {account.wins.toString()}W / {account.games.toString()}{" "}
                      recorded games · {account.kda.toFixed(2)} KDA ·{" "}
                      {account.csPerMinute.toFixed(1)} CS/min
                      {account.games < 3 ? " · low sample" : ""}
                    </span>
                  </p>
                ))}
              </div>
              {accounts.length === 0 && (
                <p className="text-sm text-scout-subtle">
                  No accounts tracked in this server yet.
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <RelationSection
                title="Recently played with"
                rows={together}
                playerId={props.playerId}
              />
              <RelationSection
                title="Rivalries"
                rows={rivals}
                playerId={props.playerId}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RelationSection(props: {
  title: string;
  rows: {
    key: string;
    name: string;
    games: number;
    wins: number;
    guildPlayerId: number | null;
    lastMatchId: string;
  }[];
  playerId: number;
}) {
  return (
    <section>
      <h4 className="font-medium">{props.title}</h4>
      {props.rows.length === 0 ? (
        <p className="text-sm text-scout-subtle">No recorded meetings.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {props.rows.map((row) => (
            <li key={row.key} className="rounded border p-2">
              {row.guildPlayerId === null ? (
                row.name
              ) : (
                <Link
                  to={`/players/${row.guildPlayerId.toString()}`}
                  className="hover:underline"
                >
                  {row.name}
                </Link>
              )}{" "}
              · {row.wins.toString()}W / {row.games.toString()} games ·{" "}
              <Link
                className="text-scout-brand hover:underline"
                to={`/players/${props.playerId.toString()}/matches/${encodeURIComponent(row.lastMatchId)}`}
              >
                last match
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
