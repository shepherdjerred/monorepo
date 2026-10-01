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
import { useTRPC } from "#src/lib/query/trpc.ts";

export function ConsumerLobbySearch() {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const trpc = useTRPC();
  const lookup = useQuery(
    trpc.consumerPlayer.multisearch.queryOptions(
      { riotIds: submitted ?? "" },
      {
        enabled: submitted !== null,
        staleTime: 0,
        gcTime: 0,
        refetchOnMount: "always",
      },
    ),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Find a lobby</CardTitle>
        <CardDescription>
          Paste up to 10 Riot IDs, one Name#Tag per line, to find players in
          your servers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(draft.trim());
          }}
        >
          <label className="block text-sm font-medium" htmlFor="lobby-ids">
            Lobby Riot IDs
          </label>
          <textarea
            id="lobby-ids"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            rows={4}
            maxLength={1000}
            placeholder={"Name#Tag\nAnother#Tag"}
            className="w-full rounded-md border border-scout-border bg-scout-surface p-2 text-sm"
          />
          <Button type="submit" disabled={draft.trim().length === 0}>
            Find guildmates
          </Button>
        </form>
        {submitted !== null && lookup.isPending && (
          <p className="text-sm text-scout-subtle">Checking cached players…</p>
        )}
        {submitted !== null && lookup.isError && (
          <p className="text-sm text-scout-danger">{lookup.error.message}</p>
        )}
        {submitted !== null && lookup.isSuccess && !lookup.isFetching && (
          <ul className="space-y-2 text-sm">
            {lookup.data.rows.map((row, index) => (
              <li
                key={`${row.riotId}:${index.toString()}`}
                className="rounded-md border p-2"
              >
                <span className="font-medium">{row.riotId}</span>
                {row.matches.length === 0 ? (
                  <span className="ml-2 text-scout-subtle">
                    Untracked by Scout
                  </span>
                ) : (
                  <ul className="ml-4 text-scout-subtle">
                    {row.matches.map((match) => (
                      <li
                        key={`${match.guild.id}:${match.playerId.toString()}`}
                      >
                        <Link
                          className="hover:underline"
                          to={`/players/${match.playerId.toString()}`}
                        >
                          {match.alias}
                        </Link>{" "}
                        · {match.guild.name} · {match.region}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
