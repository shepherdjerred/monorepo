import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { AddSubscriptionDialog } from "#src/components/add-subscription-dialog.tsx";
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
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: subsKey });
      },
    }),
  );

  if (guildId === undefined) {
    return (
      <Shell>
        <p className="text-sm text-destructive">Missing guild id</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Subscriptions</h2>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/g/${guildId}/audit`}>Audit log</Link>
          </Button>
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

      {subsQuery.data && subsQuery.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No subscriptions yet — click &quot;Add subscription&quot; to get
          started.
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
                      {sub.player.alias}
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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:py-12">
      {children}
    </div>
  );
}
