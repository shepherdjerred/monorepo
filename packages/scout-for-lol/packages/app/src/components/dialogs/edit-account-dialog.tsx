import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { findRegion, REGIONS } from "#src/lib/domain/regions.ts";
import { Dialog } from "@scout-for-lol/design-system/components/dialog";
import { SemanticDialogForm } from "#src/components/dialog-form.tsx";
import {
  focusFirstInvalid,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { EditAccountFormSchema } from "#src/lib/form-schemas.ts";

/**
 * Edit an existing account's alias and region in place (via
 * `player.updateAccount`). Region changes re-resolve the cached Riot ID
 * server-side.
 */
export function EditAccountDialog(props: {
  guildId: string;
  account: { id: number; alias: string; region: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const mutation = useMutation(
    trpc.player.updateAccount.mutationOptions({
      meta: analyticsMeta("player_account_edited"),
      onSuccess: () => {
        props.onSaved();
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const form = useScoutForm({
    defaultValues: {
      alias: props.account.alias,
      region: findRegion(props.account.region) ?? "AMERICA_NORTH",
    },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: EditAccountFormSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const parsed = EditAccountFormSchema.parse(value);
      mutation.mutate({
        guildId: props.guildId,
        accountId: props.account.id,
        alias: parsed.alias,
        region: parsed.region,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (props.open) {
      form.reset({
        alias: props.account.alias,
        region: findRegion(props.account.region) ?? "AMERICA_NORTH",
      });
    }
  }, [form, props.account.alias, props.account.region, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <form.AppForm>
        <SemanticDialogForm
          formRef={formElement}
          title="Edit account"
          description="Update the account's alias and region."
          pending={mutation.isPending}
          pendingStatus="Saving account…"
          error={error}
          submitLabel="Save"
          pendingLabel="Saving…"
          onSubmit={() => form.handleSubmit()}
          onCancel={() => {
            setError(null);
            form.reset({
              alias: props.account.alias,
              region: findRegion(props.account.region) ?? "AMERICA_NORTH",
            });
            props.onOpenChange(false);
          }}
          fieldsetClassName="m-0 grid gap-4 border-0 p-0"
        >
          <form.AppField name="alias">
            {(field) => (
              <field.TextField
                id="edit-account-alias"
                label="Player name"
                autoComplete="off"
                maxLength={100}
                required
              />
            )}
          </form.AppField>
          <form.AppField name="region">
            {(field) => (
              <field.NativeSelectField
                id="edit-account-region"
                label="Region"
                options={REGIONS}
                required
              />
            )}
          </form.AppField>
        </SemanticDialogForm>
      </form.AppForm>
    </Dialog>
  );
}
