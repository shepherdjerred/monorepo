import { useState } from "react";
import { Button } from "#src/components/ui/button.tsx";
import { SubscriptionFields } from "#src/components/subscription-fields.tsx";
import {
  emptySubscriptionValue,
  useAddSubscription,
  type SubscriptionFieldsValue,
} from "#src/lib/use-add-subscription.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";

type Channel = { id: string; name: string };

type Props = {
  guildId: string;
  channels: Channel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
};

export function AddSubscriptionDialog(props: Props) {
  const [value, setValue] = useState<SubscriptionFieldsValue>(() =>
    emptySubscriptionValue(props.channels[0]?.id ?? ""),
  );
  const { submit, isPending, error } = useAddSubscription({
    guildId: props.guildId,
    onAdded: props.onAdded,
  });

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    submit(value);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add subscription</DialogTitle>
            <DialogDescription>
              Subscribe a player&apos;s Riot ID to a Discord channel.
            </DialogDescription>
          </DialogHeader>

          <SubscriptionFields
            idPrefix="add-sub"
            channels={props.channels}
            value={value}
            onChange={setValue}
          />

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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
