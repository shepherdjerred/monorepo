import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { SubscriptionFilterSpec } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { Dialog } from "@scout-for-lol/design-system/components/dialog";
import { Field, Label } from "@scout-for-lol/design-system/components/input";
import { SemanticDialogForm } from "#src/components/dialog-form.tsx";
import { SubscriptionFilterFields } from "#src/components/subscription-filter-fields.tsx";
import {
  focusFirstInvalid,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import {
  emptySubscriptionFiltersFormValue,
  SubscriptionFiltersFormSchema,
} from "#src/lib/form-schemas.ts";

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
  const formElement = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);

  const setFiltersMutation = useMutation(
    trpc.subscription.setFilters.mutationOptions({
      meta: analyticsMeta("subscription_filters_set"),
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
      meta: analyticsMeta("subscription_channel_filters_set"),
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

  const form = useScoutForm({
    defaultValues: emptySubscriptionFiltersFormValue(firstChannel),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: SubscriptionFiltersFormSchema },
    onSubmit: ({ value }) => {
      if (action === null) return;
      setError(null);
      const parsed = SubscriptionFiltersFormSchema.parse(value);
      if (action.kind === "bulk") {
        setChannelFiltersMutation.mutate({
          guildId: props.guildId,
          channelId: parsed.channelId,
          filters: parsed.filters,
        });
        return;
      }
      setFiltersMutation.mutate({
        guildId: props.guildId,
        channelId: action.channelId,
        alias: action.alias,
        filters: parsed.filters,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (action === null) return;
    form.reset({
      filters: action.kind === "edit" ? action.initial : null,
      channelId: action.kind === "edit" ? action.channelId : firstChannel,
    });
    setError(null);
  }, [action, firstChannel, form]);

  if (action === null) return null;

  const isBulk = action.kind === "bulk";
  const pending =
    setFiltersMutation.isPending || setChannelFiltersMutation.isPending;

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
          title={isBulk ? "Set filters for a channel" : "Edit filters"}
          description={
            isBulk
              ? "Apply these queue filters to every subscription in the chosen channel."
              : `Choose which queues notify "${action.alias}" in this channel. Empty = all queues.`
          }
          pending={pending}
          pendingStatus="Saving subscription filters…"
          error={error}
          submitLabel="Save"
          pendingLabel="Saving..."
          onSubmit={() => form.handleSubmit()}
          onCancel={() => {
            props.onOpenChange(false);
          }}
          fieldsetClassName="m-0 space-y-4 border-0 p-0"
        >
          {isBulk ? (
            <form.AppField name="channelId">
              {(field) => (
                <field.NativeSelectField
                  id="bulk-filter-channel"
                  label="Channel"
                  placeholder="Pick a channel"
                  options={props.channels.map((channel) => ({
                    value: channel.id,
                    label: `#${channel.name}`,
                  }))}
                  required
                />
              )}
            </form.AppField>
          ) : null}

          <form.AppField name="filters">
            {(field) => (
              <Field>
                <Label htmlFor="filter-queues">Notify for</Label>
                <SubscriptionFilterFields
                  id="filter-queues"
                  name={field.name}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.AppField>
        </SemanticDialogForm>
      </form.AppForm>
    </Dialog>
  );
}
