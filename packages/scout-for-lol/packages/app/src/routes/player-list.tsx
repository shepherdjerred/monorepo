import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

function channelLabel(
  channels: { id: string; name: string }[] | undefined,
  channelId: string,
): string {
  const channel = channels?.find((candidate) => candidate.id === channelId);
  return channel === undefined ? channelId : `#${channel.name}`;
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleString();
}

export function PlayerList() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const safeGuildId = guildId ?? "";
  const trimmedSearch = search.trim();
  const listInput =
    trimmedSearch.length > 0
      ? { guildId: safeGuildId, query: trimmedSearch, limit: 50 }
      : { guildId: safeGuildId, limit: 50 };

  const playersQuery = useInfiniteQuery(
    trpc.player.listPlayers.infiniteQueryOptions(listInput, {
      enabled: guildId !== undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }),
  );
  const currentPlayerQuery = useQuery(
    trpc.player.getCurrentLinkedPlayer.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );

  if (guildId === undefined) {
    return <p className="text-sm text-destructive">Missing guild id</p>;
  }

  const players = playersQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Players</h2>
          <p className="text-sm text-muted-foreground">
            Search aliases and inspect linked accounts, Discord IDs, and channel
            subscriptions.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={
            currentPlayerQuery.isLoading || currentPlayerQuery.data === null
          }
          onClick={() => {
            const player = currentPlayerQuery.data;
            if (player === undefined || player === null) return;
            void navigate(
              `/g/${guildId}/players/${encodeURIComponent(player.alias)}`,
            );
          }}
        >
          My linked player
        </Button>
      </div>

      <div className="max-w-md">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search by alias"
        />
      </div>

      {playersQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading players...</p>
      )}
      {playersQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load: {playersQuery.error.message}
        </p>
      )}
      {currentPlayerQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load linked player: {currentPlayerQuery.error.message}
        </p>
      )}

      {playersQuery.data && players.length === 0 && (
        <p className="text-sm text-muted-foreground">No players found.</p>
      )}

      {playersQuery.data && players.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Discord</TableHead>
                <TableHead>Accounts</TableHead>
                <TableHead>Subscribed channels</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => (
                <TableRow key={player.id}>
                  <TableCell className="font-medium">
                    <Link
                      className="hover:underline"
                      to={`/g/${guildId}/players/${encodeURIComponent(player.alias)}`}
                    >
                      {player.alias}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {player.discordId ?? "—"}
                  </TableCell>
                  <TableCell>{player.accountCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {player.channelIds.length === 0
                      ? "—"
                      : player.channelIds
                          .map((channelId) =>
                            channelLabel(channelsQuery.data, channelId),
                          )
                          .join(", ")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(player.updatedTime)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {playersQuery.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={playersQuery.isFetchingNextPage}
          onClick={() => {
            void playersQuery.fetchNextPage();
          }}
        >
          {playersQuery.isFetchingNextPage ? "Loading..." : "Load more"}
        </Button>
      )}
    </div>
  );
}
