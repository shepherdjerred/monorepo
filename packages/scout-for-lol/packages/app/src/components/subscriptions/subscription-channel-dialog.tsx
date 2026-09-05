import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { Dialog } from "@scout-for-lol/design-system/components/dialog";
import { SemanticDialogForm } from "#src/components/dialog-form.tsx";
import {
  focusFirstInvalid,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { SubscriptionChannelFormSchema } from "#src/lib/form-schemas.ts";

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
  const formElement = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const action = props.action;

  const addChannelMutation = useMutation(
    trpc.subscription.addChannel.mutationOptions({
      meta: analyticsMeta("subscription_channel_added"),
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
      meta: analyticsMeta("subscription_moved"),
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

  const form = useScoutForm({
    defaultValues: { channelId: firstChannel },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: SubscriptionChannelFormSchema },
    onSubmit: ({ value }) => {
      if (action === null) return;
      setError(null);
      const parsed = SubscriptionChannelFormSchema.parse(value);
      if (action.kind === "add-channel") {
        addChannelMutation.mutate({
          guildId: props.guildId,
          alias: action.alias,
          channelId: parsed.channelId,
        });
        return;
      }
      moveMutation.mutate({
        guildId: props.guildId,
        alias: action.alias,
        fromChannelId: action.fromChannelId,
        toChannelId: parsed.channelId,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (action === null) return;
    const fallback =
      action.kind === "move"
        ? props.channels.find((channel) => channel.id !== action.fromChannelId)
            ?.id
        : firstChannel;
    form.reset({ channelId: fallback ?? "" });
    setError(null);
  }, [action, firstChannel, form, props.channels]);

  if (action === null) return null;

  const isMove = action.kind === "move";
  const pending = addChannelMutation.isPending || moveMutation.isPending;

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        props.onOpenChange(open);
      }}
    >
      <form.AppForm>
        <SemanticDialogForm
          formRef={formElement}
          title={isMove ? "Move subscription" : "Add channel"}
          description={
            isMove
              ? `Move "${action.alias}" from ${channelLabel(props.channels, action.fromChannelId)}.`
              : `Subscribe "${action.alias}" in another channel.`
          }
          pending={pending}
          pendingStatus="Saving subscription channel…"
          error={error}
          submitLabel="Save"
          pendingLabel="Saving..."
          onSubmit={() => form.handleSubmit()}
          onCancel={() => {
            props.onOpenChange(false);
          }}
        >
          <form.AppField name="channelId">
            {(field) => (
              <field.NativeSelectField
                id="subscription-channel-target"
                label={isMove ? "Destination channel" : "Channel"}
                placeholder="Pick a channel"
                options={props.channels.map((channel) => ({
                  value: channel.id,
                  label: `#${channel.name}`,
                }))}
                required
              />
            )}
          </form.AppField>
        </SemanticDialogForm>
      </form.AppForm>
    </Dialog>
  );
}
