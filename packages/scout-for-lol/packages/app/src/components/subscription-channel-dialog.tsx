import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";

type Channel = { id: string; name: string };

export type SubscriptionChannelAction =
  | { kind: "add-channel"; alias: string }
  | { kind: "move"; alias: string; fromChannelId: string };

type Props = {
  guildId: string;
  channels: Channel[];
  action: SubscriptionChannelAction | null;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
};

function channelLabel(channels: Channel[], channelId: string): string {
  const channel = channels.find((candidate) => candidate.id === channelId);
  return channel === undefined ? channelId : `#${channel.name}`;
}

export function SubscriptionChannelDialog(props: Props) {
  const trpc = useTRPC();
  const firstChannel = props.channels[0]?.id ?? "";
  const [channelId, setChannelId] = useState(firstChannel);
  const [error, setError] = useState<string | null>(null);
  const action = props.action;

  useEffect(() => {
    if (action === null) return;
    const fallback =
      action.kind === "move"
        ? props.channels.find((channel) => channel.id !== action.fromChannelId)
            ?.id
        : firstChannel;
    setChannelId(fallback ?? "");
    setError(null);
  }, [action, firstChannel, props.channels]);

  const addChannelMutation = useMutation(
    trpc.subscription.addChannel.mutationOptions({
      onSuccess: (result) => {
        switch (result.kind) {
          case "added":
            props.onDone("Channel added.");
            return;
          case "player-not-found":
            setError("Player not found.");
            return;
          case "already-subscribed":
            setError(
              `Already subscribed in ${channelLabel(props.channels, result.channelId)}.`,
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

  const moveMutation = useMutation(
    trpc.subscription.move.mutationOptions({
      onSuccess: (result) => {
        switch (result.kind) {
          case "moved":
            props.onDone("Subscription moved.");
            return;
          case "player-not-found":
            setError("Player not found.");
            return;
          case "not-subscribed-in-from-channel":
            setError("Player is not subscribed in the source channel.");
            return;
          case "already-subscribed-in-to-channel":
            setError(
              "Player is already subscribed in the destination channel.",
            );
            return;
          case "same-channel":
            setError("Choose a different destination channel.");
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

  const isMove = action.kind === "move";
  const pending = addChannelMutation.isPending || moveMutation.isPending;

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (action === null) return;
    setError(null);
    if (channelId.length === 0) {
      setError("Choose a channel.");
      return;
    }
    if (action.kind === "add-channel") {
      addChannelMutation.mutate({
        guildId: props.guildId,
        alias: action.alias,
        channelId,
      });
      return;
    }
    moveMutation.mutate({
      guildId: props.guildId,
      alias: action.alias,
      fromChannelId: action.fromChannelId,
      toChannelId: channelId,
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
              {isMove ? "Move subscription" : "Add channel"}
            </DialogTitle>
            <DialogDescription>
              {isMove
                ? `Move "${action.alias}" from ${channelLabel(props.channels, action.fromChannelId)}.`
                : `Subscribe "${action.alias}" in another channel.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="subscription-channel-target">
              {isMove ? "Destination channel" : "Channel"}
            </Label>
            <Select value={channelId} onValueChange={setChannelId} required>
              <SelectTrigger id="subscription-channel-target">
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

          {error !== null && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                props.onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
