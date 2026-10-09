import type { DiscordGuildId, DiscordChannelId } from "@scout-for-lol/data";
import { useEffect, useRef } from "react";
import {
  SubscriptionFields,
  subscriptionFormOptions,
} from "#src/components/subscription/subscription-fields.tsx";
import { useAddSubscription } from "#src/lib/player/use-add-subscription.ts";
import {
  emptySubscriptionFormValue,
  SubscriptionFormSchema,
} from "#src/lib/form-schemas.ts";
import {
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/overlays/dialog";
import {
  DialogFormError,
  DialogFormFooter,
} from "#src/components/dialog-form.tsx";
import { channelAvailabilityForQuery } from "#src/components/channel-select-support.tsx";

type Channel = { id: DiscordChannelId; name: string };

type ChannelListQuery = Parameters<typeof channelAvailabilityForQuery>[0] & {
  refetch: () => Promise<unknown>;
};

type Props = {
  guildId: DiscordGuildId;
  channels: Channel[];
  channelAvailability: {
    status: "loading" | "error" | "empty" | "ready";
    message?: string;
  };
  onRetryChannels: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
};

export function AddSubscriptionDialog(props: Props) {
  const formElement = useRef<HTMLFormElement>(null);
  const wasOpen = useRef(false);
  const { submit, isPending, error, clearError } = useAddSubscription({
    guildId: props.guildId,
    onAdded: () => {
      form.reset();
      props.onAdded();
    },
  });

  const form = useScoutForm({
    ...subscriptionFormOptions,
    defaultValues: emptySubscriptionFormValue(props.channels[0]?.id ?? ""),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: SubscriptionFormSchema },
    onSubmit: ({ value }) => {
      submit(value);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (!props.open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    clearError();
    form.reset(emptySubscriptionFormValue(props.channels[0]?.id ?? ""));
  }, [clearError, form, props.channels, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overscroll-contain">
        <form.AppForm>
          <form
            ref={formElement}
            onSubmit={(event) => {
              handleFormSubmit(event, () => form.handleSubmit());
            }}
            aria-busy={isPending}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Add subscription</DialogTitle>
              <DialogDescription>
                Track a League account and send its match reports to a Discord
                channel.
              </DialogDescription>
            </DialogHeader>

            <fieldset disabled={isPending} className="m-0 border-0 p-0">
              <SubscriptionFields
                form={form}
                idPrefix="add-sub"
                guildId={props.guildId}
                channels={props.channels}
                channelAvailability={props.channelAvailability}
                onRetryChannels={props.onRetryChannels}
              />
            </fieldset>

            <div className="space-y-2">
              <DialogFormError error={error} />
              <DialogFormFooter
                pending={isPending}
                submitLabel="Add"
                pendingLabel="Adding…"
                submitDisabled={
                  props.channelAvailability.status === "loading" ||
                  props.channels.length === 0
                }
                onCancel={() => {
                  props.onOpenChange(false);
                }}
              />
              <FormPendingStatus pending={isPending}>
                Adding subscription…
              </FormPendingStatus>
            </div>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

export function AddSubscriptionDialogFromQuery(props: {
  guildId: DiscordGuildId;
  channelsQuery: ChannelListQuery;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  return (
    <AddSubscriptionDialog
      guildId={props.guildId}
      channels={props.channelsQuery.data ?? []}
      channelAvailability={channelAvailabilityForQuery(props.channelsQuery)}
      onRetryChannels={() => void props.channelsQuery.refetch()}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onAdded={props.onAdded}
    />
  );
}
