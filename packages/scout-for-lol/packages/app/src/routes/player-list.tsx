import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { AddSubscriptionDialog } from "#src/components/dialogs/add-subscription-dialog.tsx";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ConceptCards } from "#src/components/concept-cards.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@scout-for-lol/design-system/components/collapsible";
import { ChevronDown } from "lucide-react";
import { Input } from "@scout-for-lol/design-system/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { DiscordUser } from "#src/components/identity/discord-user.tsx";
import { LoadMore } from "#src/components/load-more.tsx";
import { STALE_TIME_SLOW_LIST } from "#src/lib/api/stale-times.ts";

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
  const queryClient = useQueryClient();
  const { perms } = usePermissions(guildId);
  const [search, setSearch] = useState("");
  const [isAddOpen, setAddOpen] = useState(false);
  const safeGuildId = guildId ?? "";
  const trimmedSearch = search.trim();
  const listInput =
    trimmedSearch.length > 0
      ? { guildId: safeGuildId, query: trimmedSearch, limit: 50 }
      : { guildId: safeGuildId, limit: 50 };

  const playersQuery = useInfiniteQuery(
    trpc.player.listPlayers.infiniteQueryOptions(listInput, {
      enabled: guildId !== undefined,
      staleTime: STALE_TIME_SLOW_LIST,
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
      { enabled: guildId !== undefined, staleTime: STALE_TIME_SLOW_LIST },
    ),
  );

  if (guildId === undefined) {
    return <p className="text-sm text-scout-danger">Missing guild id</p>;
  }

  const players = playersQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Players</h2>
          <Collapsible>
            <CollapsibleTrigger className="flex min-h-6 items-center gap-1 text-sm text-scout-subtle hover:text-scout-ink">
              What are players, accounts, and subscriptions?
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <ConceptCards />
            </CollapsibleContent>
          </Collapsible>
        </div>
        <div className="flex items-center gap-2">
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
          {perms.can("subscriptions", "create") && (
            <Button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                setAddOpen(true);
              }}
            >
              + Track player
            </Button>
          )}
        </div>
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
        <p role="status" className="text-sm text-scout-subtle">
          Loading players...
        </p>
      )}
      {playersQuery.error && (
        <p className="text-sm text-scout-danger">
          Failed to load: {playersQuery.error.message}
        </p>
      )}
      {currentPlayerQuery.error && (
        <p className="text-sm text-scout-danger">
          Failed to load linked player: {currentPlayerQuery.error.message}
        </p>
      )}

      {playersQuery.data && players.length === 0 && (
        <p className="text-sm text-scout-subtle">No players found.</p>
      )}

      {playersQuery.data && players.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <caption className="sr-only">Tracked players</caption>
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
                    {/* No hover prefetch of getPlayer: that read triggers a
                        synchronous Riot ID refresh server-side, so hovering a
                        long list would fan out dozens of Riot API calls without
                        the user opening any player. */}
                    <Link
                      className="underline"
                      to={`/g/${guildId}/players/${encodeURIComponent(player.alias)}`}
                    >
                      {player.alias}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <DiscordUser
                      id={player.discordId}
                      name={player.discordUser}
                    />
                  </TableCell>
                  <TableCell>{player.accountCount}</TableCell>
                  <TableCell className="text-scout-subtle">
                    {player.channelIds.length === 0
                      ? "—"
                      : player.channelIds
                          .map((channelId) =>
                            channelLabel(channelsQuery.data, channelId),
                          )
                          .join(", ")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-scout-subtle">
                    {formatDate(player.updatedTime)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <LoadMore
        hasNextPage={playersQuery.hasNextPage}
        isFetchingNextPage={playersQuery.isFetchingNextPage}
        onLoadMore={() => {
          void playersQuery.fetchNextPage();
        }}
      />

      <AddSubscriptionDialog
        guildId={guildId}
        channels={channelsQuery.data ?? []}
        open={isAddOpen}
        onOpenChange={setAddOpen}
        onAdded={() => {
          void queryClient.invalidateQueries({
            queryKey: trpc.player.listPlayers.pathKey(),
          });
          void queryClient.invalidateQueries({
            queryKey: trpc.subscription.list.pathKey(),
          });
          // Tracking yourself links a player to the signed-in Discord ID; the
          // current-linked-player query may be cached as null, so invalidate it
          // too or "My linked player" stays disabled until a later refetch.
          void queryClient.invalidateQueries({
            queryKey: trpc.player.getCurrentLinkedPlayer.pathKey(),
          });
          setAddOpen(false);
        }}
      />
    </div>
  );
}
