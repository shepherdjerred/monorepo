import { useEffect, useRef } from "react";
import {
  SubscriptionFields,
  subscriptionFormOptions,
} from "#src/components/subscription-fields.tsx";
import { useAddSubscription } from "#src/lib/use-add-subscription.ts";
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
} from "@scout-for-lol/design-system/components/dialog";
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
  const formElement = useRef<HTMLFormElement>(null);
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
    if (props.open) {
      clearError();
      form.reset(emptySubscriptionFormValue(props.channels[0]?.id ?? ""));
    }
  }, [clearError, form, props.channels, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
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
                Subscribe a player&apos;s Riot ID to a Discord channel.
              </DialogDescription>
            </DialogHeader>

            <fieldset disabled={isPending} className="m-0 border-0 p-0">
              <SubscriptionFields
                form={form}
                idPrefix="add-sub"
                guildId={props.guildId}
                channels={props.channels}
              />
            </fieldset>

            <DialogFormError error={error} />

            <DialogFormFooter
              pending={isPending}
              submitLabel="Add"
              pendingLabel="Adding…"
              onCancel={() => {
                props.onOpenChange(false);
              }}
            />
            <FormPendingStatus pending={isPending}>
              Adding subscription…
            </FormPendingStatus>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
