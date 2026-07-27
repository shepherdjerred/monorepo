import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import type { usePermissions } from "#src/hooks/use-permissions.ts";
import type { ReactNode } from "react";
import { Button } from "#src/components/ui/button.tsx";
import {
  PlayerSubscriptionsTable,
  Section,
  type PlayerSubscriptionRow,
} from "#src/components/player-detail-sections.tsx";
import {
  SubscriptionChannelDialog,
  type SubscriptionChannelAction,
} from "#src/components/subscription-channel-dialog.tsx";
import {
  SubscriptionFilterDialog,
  type SubscriptionFilterAction,
} from "#src/components/subscription-filter-dialog.tsx";
import {
  muteResultOutcome,
  removeResultOutcome,
} from "#src/lib/subscription-result-messages.ts";

type PlayerPermissions = ReturnType<typeof usePermissions>["perms"];

/**
 * The fully-manageable subscriptions section of the player page: hosts the
 * same channel/filter dialogs as the Subscriptions tab plus remove and an
 * optimistic mute toggle against the player payload.
 */
function Allowed(props: { when: boolean; children: ReactNode }) {
  return props.when ? props.children : null;
}

export function PlayerSubscriptionsManager(props: {
  guildId: string;
  alias: string;
  subscriptions: PlayerSubscriptionRow[];
  channels: { id: string; name: string }[] | undefined;
  perms: PlayerPermissions;
  refresh: () => void;
  setActionError: (message: string | null) => void;
}) {
  const { guildId, alias, refresh, setActionError } = props;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const playerKey = trpc.player.getPlayer.queryKey({ guildId, alias });
  const [channelAction, setChannelAction] =
    useState<SubscriptionChannelAction | null>(null);
  const [filterAction, setFilterAction] =
    useState<SubscriptionFilterAction | null>(null);

  const removeSubscriptionMutation = useMutation(
    trpc.subscription.remove.mutationOptions({
      onSuccess: (result) => {
        const outcome = removeResultOutcome(result);
        setActionError(outcome.ok ? null : outcome.message);
        if (outcome.ok) refresh();
      },
      onError: (err) => {
        setActionError(err.message);
      },
    }),
  );
  const muteSubscriptionMutation = useMutation(
    trpc.subscription.setMuted.mutationOptions({
      // Optimistic toggle against the player payload; reconciled on settle.
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: playerKey });
        const previous = queryClient.getQueryData(playerKey);
        queryClient.setQueryData(playerKey, (data) =>
          data === undefined
            ? data
            : {
                ...data,
                subscriptions: data.subscriptions.map((subscription) =>
                  subscription.channelId === variables.channelId
                    ? { ...subscription, isMuted: variables.isMuted }
                    : subscription,
                ),
              },
        );
        return { previous };
      },
      onSuccess: (result, variables, context) => {
        // Application-level failures (not-subscribed-in-channel, internal-error)
        // come back as a normal result, not a throw, so onError's rollback never
        // runs — undo the optimistic mute flip here before the onSettled refetch
        // reconciles (and so it isn't left stale if that refetch fails).
        if (result.kind !== "updated" && context.previous !== undefined) {
          queryClient.setQueryData(playerKey, context.previous);
        }
        const outcome = muteResultOutcome(result, variables.isMuted);
        setActionError(outcome.ok ? null : outcome.message);
      },
      onError: (err, _variables, context) => {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(playerKey, context.previous);
        }
        setActionError(err.message);
      },
      onSettled: () => {
        refresh();
      },
    }),
  );

  return (
    <>
      <Section
        title="Subscriptions"
        action={
          <Allowed when={props.perms.can("subscriptions", "create")}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setChannelAction({ kind: "add-channel", alias });
              }}
            >
              + Add to channel
            </Button>
          </Allowed>
        }
      >
        <PlayerSubscriptionsTable
          subscriptions={props.subscriptions}
          channels={props.channels}
          canUpdate={props.perms.can("subscriptions", "update")}
          canCreate={props.perms.can("subscriptions", "create")}
          canDelete={props.perms.can("subscriptions", "delete")}
          mutationPending={
            muteSubscriptionMutation.isPending ||
            removeSubscriptionMutation.isPending
          }
          onEditFilters={(subscription) => {
            setFilterAction({
              kind: "edit",
              alias,
              channelId: subscription.channelId,
              initial: subscription.filters ?? null,
            });
          }}
          onMove={(subscription) => {
            setChannelAction({
              kind: "move",
              alias,
              fromChannelId: subscription.channelId,
            });
          }}
          onToggleMute={(subscription) => {
            muteSubscriptionMutation.mutate({
              guildId,
              channelId: subscription.channelId,
              alias,
              isMuted: !subscription.isMuted,
            });
          }}
          onAddChannel={() => {
            setChannelAction({ kind: "add-channel", alias });
          }}
          onRemove={(subscription) => {
            if (
              !globalThis.confirm(
                `Remove "${alias}" from ${subscription.channelId}?`,
              )
            ) {
              return;
            }
            removeSubscriptionMutation.mutate({
              guildId,
              channelId: subscription.channelId,
              alias,
            });
          }}
        />
      </Section>

      <SubscriptionChannelDialog
        guildId={guildId}
        channels={props.channels ?? []}
        action={channelAction}
        onOpenChange={(open) => {
          if (!open) setChannelAction(null);
        }}
        onDone={() => {
          setChannelAction(null);
          refresh();
        }}
      />
      <SubscriptionFilterDialog
        guildId={guildId}
        channels={props.channels ?? []}
        action={filterAction}
        onOpenChange={(open) => {
          if (!open) setFilterAction(null);
        }}
        onDone={() => {
          setFilterAction(null);
          refresh();
        }}
      />
    </>
  );
}
