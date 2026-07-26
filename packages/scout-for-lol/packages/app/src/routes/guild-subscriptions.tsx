import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";

import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta, track } from "#src/lib/analytics.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { AddSubscriptionDialog } from "#src/components/add-subscription-dialog.tsx";
import {
  SubscriptionChannelDialog,
  type SubscriptionChannelAction,
} from "#src/components/subscription-channel-dialog.tsx";
import {
  SubscriptionFilterDialog,
  type SubscriptionFilterAction,
} from "#src/components/subscription-filter-dialog.tsx";
import { FilterSummary } from "#src/components/subscription-filter-summary.tsx";
import {
  muteResultOutcome,
  removeResultOutcome,
} from "#src/lib/subscription-result-messages.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#src/components/ui/dropdown-menu.tsx";
import { LoadMore } from "#src/components/load-more.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";

function accountLabel(account: {
  alias: string;
  region: string;
  riotGameName: string | null;
  riotTagLine: string | null;
}): string {
  const name =
    account.riotGameName === null
      ? account.alias
      : `${account.riotGameName}#${account.riotTagLine ?? ""}`;
  return `${name} (${account.region})`;
}

export function GuildSubscriptions() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { perms } = usePermissions(guildId);
  const canCreate = perms.can("subscriptions", "create");
  const canUpdate = perms.can("subscriptions", "update");
  const canDelete = perms.can("subscriptions", "delete");
  const [isAddOpen, setAddOpen] = useState(false);
  const [channelAction, setChannelAction] =
    useState<SubscriptionChannelAction | null>(null);
  const [filterAction, setFilterAction] =
    useState<SubscriptionFilterAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeGuildId = guildId ?? "";
  // pathKey matches both the regular and infinite query caches for this
  // procedure, so invalidation refreshes the paginated list.
  const subsKey = trpc.subscription.list.pathKey();
  const invalidatePlayerSurfaces = () => {
    // Keep the player page + Players list in sync with tab edits.
    void queryClient.invalidateQueries({
      queryKey: trpc.player.getPlayer.pathKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.player.listPlayers.pathKey(),
    });
  };
  const subsOptions = trpc.subscription.list.infiniteQueryOptions(
    { guildId: safeGuildId, limit: 50 },
    {
      enabled: guildId !== undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );
  const subsQuery = useInfiniteQuery(subsOptions);
  const subscriptions =
    subsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined, staleTime: STALE_TIME_SLOW_LIST },
    ),
  );
  const removeMutation = useMutation(
    trpc.subscription.remove.mutationOptions({
      meta: analyticsMeta("subscription_removed"),
      onSuccess: (result) => {
        const outcome = removeResultOutcome(result);
        if (outcome.ok) {
          setMessage(outcome.message);
          setError(null);
          void queryClient.invalidateQueries({ queryKey: subsKey });
          invalidatePlayerSurfaces();
          return;
        }
        setError(outcome.message);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const muteMutation = useMutation(
    trpc.subscription.setMuted.mutationOptions({
      // Optimistic toggle: flip isMuted in the cached list immediately,
      // roll back on error, reconcile with the server on settle.
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: subsKey });
        const previous = queryClient.getQueryData(subsOptions.queryKey);
        queryClient.setQueryData(subsOptions.queryKey, (data) =>
          data === undefined
            ? data
            : {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    item.player.alias === variables.alias &&
                    item.channelId === variables.channelId
                      ? { ...item, isMuted: variables.isMuted }
                      : item,
                  ),
                })),
              },
        );
        return { previous };
      },
      onSuccess: (result, variables, context) => {
        // Application-level failures come back as a normal result (not a throw),
        // so onError's rollback never runs — undo the optimistic mute flip here
        // before the invalidation refetch reconciles.
        if (result.kind !== "updated" && context.previous !== undefined) {
          queryClient.setQueryData(subsOptions.queryKey, context.previous);
        }
        const outcome = muteResultOutcome(result, variables.isMuted);
        if (outcome.ok) {
          track(
            variables.isMuted ? "subscription_muted" : "subscription_unmuted",
          );
          setMessage(outcome.message);
          setError(null);
          return;
        }
        setError(outcome.message);
      },
      onError: (err, _variables, context) => {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(subsOptions.queryKey, context.previous);
        }
        setError(err.message);
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: subsKey });
        invalidatePlayerSurfaces();
      },
    }),
  );

  if (guildId === undefined) {
    return (
      <div>
        <p className="text-sm text-destructive">Missing guild id</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Subscriptions</h2>
        <div className="flex items-center gap-2">
          {canUpdate && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setFilterAction({ kind: "bulk" });
              }}
            >
              Set filters for a channel
            </Button>
          )}
          {canCreate && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setAddOpen(true);
              }}
            >
              + Add subscription
            </Button>
          )}
        </div>
      </div>

      {subsQuery.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading subscriptions…
        </p>
      )}
      {subsQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load: {subsQuery.error.message}
        </p>
      )}
      {removeMutation.error && (
        <p className="text-sm text-destructive">
          Failed to remove: {removeMutation.error.message}
        </p>
      )}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {message !== null && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}

      {subsQuery.data && subscriptions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No subscriptions yet — click &quot;Add subscription&quot;, or follow
          the{" "}
          <Link to="/welcome" className="underline">
            setup guide
          </Link>
          .
        </p>
      )}

      {subsQuery.data && subscriptions.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <caption className="sr-only">
              Subscriptions: tracked players and the channels their match
              reports post to
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Accounts</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Filters</TableHead>
                <TableHead className="w-1" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((sub) => {
                const channel = channelsQuery.data?.find(
                  (c) => c.id === sub.channelId,
                );
                return (
                  <TableRow key={sub.subscriptionId}>
                    <TableCell className="font-medium">
                      <Link
                        className="underline"
                        to={`/g/${guildId}/players/${encodeURIComponent(sub.player.alias)}`}
                      >
                        {sub.player.alias}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {sub.player.accounts
                        .map((account) => accountLabel(account))
                        .join(", ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {channel === undefined
                        ? sub.channelId
                        : `#${channel.name}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <FilterSummary
                        filters={sub.filters}
                        isMuted={sub.isMuted}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canUpdate && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFilterAction({
                                kind: "edit",
                                alias: sub.player.alias,
                                channelId: sub.channelId,
                                initial: sub.filters,
                              });
                            }}
                          >
                            Edit filters
                          </Button>
                        )}
                        {(canUpdate || canCreate || canDelete) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Actions for ${sub.player.alias}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canUpdate && (
                                <>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setChannelAction({
                                        kind: "move",
                                        alias: sub.player.alias,
                                        fromChannelId: sub.channelId,
                                      });
                                    }}
                                  >
                                    Move to another channel
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={muteMutation.isPending}
                                    onSelect={() => {
                                      muteMutation.mutate({
                                        guildId,
                                        channelId: sub.channelId,
                                        alias: sub.player.alias,
                                        isMuted: !sub.isMuted,
                                      });
                                    }}
                                  >
                                    {sub.isMuted ? "Unmute" : "Mute"}
                                  </DropdownMenuItem>
                                </>
                              )}
                              {canCreate && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setChannelAction({
                                      kind: "add-channel",
                                      alias: sub.player.alias,
                                    });
                                  }}
                                >
                                  Add channel
                                </DropdownMenuItem>
                              )}
                              {canDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    disabled={removeMutation.isPending}
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => {
                                      if (
                                        !globalThis.confirm(
                                          `Remove "${sub.player.alias}" from this channel?`,
                                        )
                                      ) {
                                        return;
                                      }
                                      removeMutation.mutate({
                                        guildId,
                                        channelId: sub.channelId,
                                        alias: sub.player.alias,
                                      });
                                    }}
                                  >
                                    Remove
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <LoadMore
        hasNextPage={subsQuery.hasNextPage}
        isFetchingNextPage={subsQuery.isFetchingNextPage}
        onLoadMore={() => {
          void subsQuery.fetchNextPage();
        }}
      />

      <AddSubscriptionDialog
        guildId={guildId}
        channels={channelsQuery.data ?? []}
        open={isAddOpen}
        onOpenChange={setAddOpen}
        onAdded={() => {
          void queryClient.invalidateQueries({ queryKey: subsKey });
          setAddOpen(false);
        }}
      />
      <SubscriptionChannelDialog
        guildId={guildId}
        channels={channelsQuery.data ?? []}
        action={channelAction}
        onOpenChange={(open) => {
          if (!open) setChannelAction(null);
        }}
        onDone={(nextMessage) => {
          setMessage(nextMessage);
          setError(null);
          setChannelAction(null);
          void queryClient.invalidateQueries({ queryKey: subsKey });
        }}
      />
      <SubscriptionFilterDialog
        guildId={guildId}
        channels={channelsQuery.data ?? []}
        action={filterAction}
        onOpenChange={(open) => {
          if (!open) setFilterAction(null);
        }}
        onDone={(nextMessage) => {
          setMessage(nextMessage);
          setError(null);
          setFilterAction(null);
          void queryClient.invalidateQueries({ queryKey: subsKey });
        }}
      />
    </div>
  );
}
