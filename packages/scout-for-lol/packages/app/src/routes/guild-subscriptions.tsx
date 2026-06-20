import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { AddSubscriptionDialog } from "#src/components/add-subscription-dialog.tsx";
import {
  SubscriptionChannelDialog,
  type SubscriptionChannelAction,
} from "#src/components/subscription-channel-dialog.tsx";
import { Button } from "#src/components/ui/button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

export function GuildSubscriptions() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isAddOpen, setAddOpen] = useState(false);
  const [channelAction, setChannelAction] =
    useState<SubscriptionChannelAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeGuildId = guildId ?? "";
  const subsKey = trpc.subscription.list.queryKey({ guildId: safeGuildId });
  const subsQuery = useQuery(
    trpc.subscription.list.queryOptions(
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
  const removeMutation = useMutation(
    trpc.subscription.remove.mutationOptions({
      onSuccess: (result) => {
        switch (result.kind) {
          case "removed":
            setMessage("Subscription removed.");
            setError(null);
            void queryClient.invalidateQueries({ queryKey: subsKey });
            return;
          case "player-not-found":
            setError("Player not found.");
            return;
          case "not-subscribed-in-channel":
            setError("Player is not subscribed in that channel.");
            return;
          case "internal-error":
            setError(result.message);
            return;
        }
      },
      onError: (err) => {
        setError(err.message);
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
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setAddOpen(true);
            }}
          >
            + Add subscription
          </Button>
        </div>
      </div>

      {subsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading subscriptions…</p>
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

      {subsQuery.data && subsQuery.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No subscriptions yet — click &quot;Add subscription&quot;, or follow
          the{" "}
          <Link to="/welcome" className="underline">
            setup guide
          </Link>
          .
        </p>
      )}

      {subsQuery.data && subsQuery.data.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Accounts</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="w-1" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {subsQuery.data.map((sub) => {
                const channel = channelsQuery.data?.find(
                  (c) => c.id === sub.channelId,
                );
                return (
                  <TableRow key={sub.subscriptionId}>
                    <TableCell className="font-medium">
                      <Link
                        className="hover:underline"
                        to={`/g/${guildId}/players/${encodeURIComponent(sub.player.alias)}`}
                      >
                        {sub.player.alias}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {sub.player.accounts
                        .map((a) => `${a.alias} (${a.region})`)
                        .join(", ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {channel === undefined
                        ? sub.channelId
                        : `#${channel.name}`}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setChannelAction({
                              kind: "add-channel",
                              alias: sub.player.alias,
                            });
                          }}
                        >
                          Add channel
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setChannelAction({
                              kind: "move",
                              alias: sub.player.alias,
                              fromChannelId: sub.channelId,
                            });
                          }}
                        >
                          Move
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={removeMutation.isPending}
                          onClick={() => {
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
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

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
    </div>
  );
}
