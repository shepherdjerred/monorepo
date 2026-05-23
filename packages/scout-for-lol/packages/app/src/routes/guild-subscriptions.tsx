import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { AddSubscriptionDialog } from "#src/components/add-subscription-dialog.tsx";

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

  if (guildId === undefined) return <p>Missing guild id</p>;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h2>Subscriptions</h2>
        <div>
          <Link to={`/g/${guildId}/audit`} style={{ marginRight: "1rem" }}>
            Audit log
          </Link>
          <button
            type="button"
            onClick={() => {
              setAddOpen(true);
            }}
          >
            + Add subscription
          </button>
        </div>
      </div>

      {subsQuery.isLoading && <p>Loading subscriptions…</p>}
      {subsQuery.error && (
        <p style={{ color: "crimson" }}>
          Failed to load: {subsQuery.error.message}
        </p>
      )}

      {subsQuery.data && subsQuery.data.length === 0 && (
        <p>
          No subscriptions yet — click &quot;Add subscription&quot; to get
          started.
        </p>
      )}

      {subsQuery.data && subsQuery.data.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "0.5rem" }}>Alias</th>
              <th style={{ padding: "0.5rem" }}>Accounts</th>
              <th style={{ padding: "0.5rem" }}>Channel</th>
              <th style={{ padding: "0.5rem" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {subsQuery.data.map((sub) => {
              const channel = channelsQuery.data?.find(
                (c) => c.id === sub.channelId,
              );
              return (
                <tr
                  key={sub.subscriptionId}
                  style={{ borderBottom: "1px solid #f0f0f0" }}
                >
                  <td style={{ padding: "0.5rem" }}>{sub.player.alias}</td>
                  <td style={{ padding: "0.5rem" }}>
                    {sub.player.accounts
                      .map((a) => `${a.alias} (${a.region})`)
                      .join(", ")}
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    {channel === undefined ? sub.channelId : `#${channel.name}`}
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    <button
                      type="button"
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
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {isAddOpen && (
        <AddSubscriptionDialog
          guildId={guildId}
          channels={channelsQuery.data ?? []}
          onClose={() => {
            setAddOpen(false);
          }}
          onAdded={() => {
            void queryClient.invalidateQueries({ queryKey: subsKey });
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}
