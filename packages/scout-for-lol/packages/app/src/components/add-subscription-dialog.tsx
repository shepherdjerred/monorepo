import { useState } from "react";
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
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";
import {
  DialogFormError,
  DialogFormFooter,
} from "#src/components/dialog-form.tsx";

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
            guildId={props.guildId}
            channels={props.channels}
            value={value}
            onChange={setValue}
          />

          <DialogFormError error={error} />

          <DialogFormFooter
            pending={isPending}
            submitLabel="Add"
            pendingLabel="Adding…"
            onCancel={() => {
              props.onOpenChange(false);
            }}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
