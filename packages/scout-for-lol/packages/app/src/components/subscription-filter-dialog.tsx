import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { SubscriptionFilterSpec } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  DialogFormError,
  DialogFormFooter,
} from "#src/components/dialog-form.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";
import { SubscriptionFilterFields } from "#src/components/subscription-filter-fields.tsx";

type Channel = { id: string; name: string };

export type SubscriptionFilterAction =
  | {
      kind: "edit";
      alias: string;
      channelId: string;
      initial: SubscriptionFilterSpec | null;
    }
  | { kind: "bulk" };

type Props = {
  guildId: string;
  channels: Channel[];
  action: SubscriptionFilterAction | null;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
};

export function SubscriptionFilterDialog(props: Props) {
  const trpc = useTRPC();
  const action = props.action;
  const firstChannel = props.channels[0]?.id ?? "";
  const [filters, setFilters] = useState<SubscriptionFilterSpec | null>(null);
  const [channelId, setChannelId] = useState(firstChannel);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (action === null) return;
    setFilters(action.kind === "edit" ? action.initial : null);
    setChannelId(action.kind === "edit" ? action.channelId : firstChannel);
    setError(null);
  }, [action, firstChannel]);

  const setFiltersMutation = useMutation(
    trpc.subscription.setFilters.mutationOptions({
      onSuccess: (result) => {
        switch (result.kind) {
          case "updated":
            props.onDone("Filters updated.");
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

  const setChannelFiltersMutation = useMutation(
    trpc.subscription.setChannelFilters.mutationOptions({
      onSuccess: (result) => {
        switch (result.kind) {
          case "updated":
            props.onDone(
              `Filters updated for ${result.count.toString()} subscription${result.count === 1 ? "" : "s"}.`,
            );
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

  if (action === null) return null;

  const isBulk = action.kind === "bulk";
  const pending =
    setFiltersMutation.isPending || setChannelFiltersMutation.isPending;

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (action === null) return;
    setError(null);
    if (action.kind === "bulk") {
      if (channelId.length === 0) {
        setError("Choose a channel.");
        return;
      }
      setChannelFiltersMutation.mutate({
        guildId: props.guildId,
        channelId,
        filters,
      });
      return;
    }
    setFiltersMutation.mutate({
      guildId: props.guildId,
      channelId: action.channelId,
      alias: action.alias,
      filters,
    });
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        props.onOpenChange(open);
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {isBulk ? "Set filters for a channel" : "Edit filters"}
            </DialogTitle>
            <DialogDescription>
              {isBulk
                ? "Apply these queue filters to every subscription in the chosen channel."
                : `Choose which queues notify "${action.alias}" in this channel. Empty = all queues.`}
            </DialogDescription>
          </DialogHeader>

          {isBulk && (
            <div className="space-y-2">
              <Label htmlFor="bulk-filter-channel">Channel</Label>
              <Select value={channelId} onValueChange={setChannelId} required>
                <SelectTrigger id="bulk-filter-channel">
                  <SelectValue placeholder="Pick a channel" />
                </SelectTrigger>
                <SelectContent>
                  {props.channels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      #{channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="filter-queues">Notify for</Label>
            <SubscriptionFilterFields
              id="filter-queues"
              value={filters}
              onChange={setFilters}
            />
          </div>

          <DialogFormError error={error} />

          <DialogFormFooter
            pending={pending}
            submitLabel="Save"
            pendingLabel="Saving..."
            onCancel={() => {
              props.onOpenChange(false);
            }}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
