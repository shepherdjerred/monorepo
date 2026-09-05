import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { findRegion, REGIONS } from "#src/lib/domain/regions.ts";
import {
  Field,
  FieldError,
  Label,
} from "@scout-for-lol/design-system/components/input";
import { RiotIdCombobox } from "#src/components/identity/riot-id-combobox.tsx";
import { Dialog } from "@scout-for-lol/design-system/components/dialog";
import { SemanticDialogForm } from "#src/components/dialog-form.tsx";
import {
  fieldErrorMessage,
  focusFirstInvalid,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { AddAccountFormSchema } from "#src/lib/form-schemas.ts";

/** Add a Riot account to an existing player (via `player.addAccount`). */
export function AddAccountDialog(props: {
  guildId: string;
  playerAlias: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const mutation = useMutation(
    trpc.player.addAccount.mutationOptions({
      meta: analyticsMeta("player_account_added"),
      onSuccess: () => {
        props.onAdded();
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const form = useScoutForm({
    defaultValues: { riotId: "", region: "AMERICA_NORTH" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: AddAccountFormSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const parsed = AddAccountFormSchema.parse(value);
      mutation.mutate({
        guildId: props.guildId,
        playerAlias: props.playerAlias,
        riotId: parsed.riotId,
        region: parsed.region,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (props.open) form.reset({ riotId: "", region: "AMERICA_NORTH" });
  }, [form, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <form.AppForm>
        <SemanticDialogForm
          formRef={formElement}
          title="Add account"
          description={
            <>Attach a Riot account to &quot;{props.playerAlias}&quot;.</>
          }
          pending={mutation.isPending}
          pendingStatus="Adding account…"
          error={error}
          submitLabel="Add"
          pendingLabel="Adding…"
          onSubmit={() => form.handleSubmit()}
          onCancel={() => {
            setError(null);
            form.reset({ riotId: "", region: "AMERICA_NORTH" });
            props.onOpenChange(false);
          }}
          fieldsetClassName="m-0 grid gap-4 border-0 p-0"
        >
          <form.AppField name="riotId">
            {(field) => {
              const message = field.state.meta.isTouched
                ? fieldErrorMessage(field.state.meta.errors)
                : undefined;
              return (
                <Field>
                  <Label htmlFor="add-account-dialog-riot">Riot ID</Label>
                  <form.Subscribe selector={(state) => state.values.region}>
                    {(region) => (
                      <RiotIdCombobox
                        id="add-account-dialog-riot"
                        name={field.name}
                        guildId={props.guildId}
                        region={findRegion(region) ?? "AMERICA_NORTH"}
                        value={field.state.value}
                        onValueChange={field.handleChange}
                        onSelectAccount={({ region: accountRegion }) => {
                          const match = findRegion(accountRegion);
                          if (match !== null) {
                            form.setFieldValue("region", match);
                          }
                        }}
                        required
                        ariaInvalid={message !== undefined}
                        {...(message === undefined
                          ? {}
                          : {
                              ariaDescribedBy: "add-account-dialog-riot-error",
                            })}
                      />
                    )}
                  </form.Subscribe>
                  {message === undefined ? null : (
                    <FieldError id="add-account-dialog-riot-error">
                      {message}
                    </FieldError>
                  )}
                </Field>
              );
            }}
          </form.AppField>
          <form.AppField name="region">
            {(field) => (
              <field.NativeSelectField
                id="add-account-dialog-region"
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
