import { useEffect, useRef } from "react";
import type { z } from "zod";
import {
  Field,
  FieldError,
  Label,
} from "@scout-for-lol/design-system/components/input";
import { PlayerAliasCombobox } from "#src/components/players/player-alias-combobox.tsx";
import {
  fieldErrorMessage,
  focusFirstInvalid,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";

type AliasField = {
  name: string;
  state: {
    value: string;
    meta: { isTouched: boolean; errors: unknown[] };
  };
  handleChange: (value: string) => void;
};

type AliasSchema = z.ZodType<{ alias: string }, { alias: string }>;

export function usePlayerAliasDialogForm(
  open: boolean,
  schema: AliasSchema,
  submit: (alias: string) => void,
) {
  const formElement = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: { alias: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => {
      submit(schema.parse(value).alias);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (open) form.reset({ alias: "" });
  }, [form, open]);

  return { form, formElement };
}

export function PlayerAliasFormField(props: {
  id: string;
  label: string;
  guildId: string;
  field: AliasField;
}) {
  const error = props.field.state.meta.isTouched
    ? fieldErrorMessage(props.field.state.meta.errors)
    : undefined;
  const errorId = `${props.id}-error`;
  return (
    <Field>
      <Label htmlFor={props.id}>{props.label}</Label>
      <PlayerAliasCombobox
        id={props.id}
        name={props.field.name}
        guildId={props.guildId}
        value={props.field.state.value}
        onChange={props.field.handleChange}
        required
        ariaInvalid={error !== undefined}
        {...(error === undefined ? {} : { ariaDescribedBy: errorId })}
      />
      {error === undefined ? null : (
        <FieldError id={errorId}>{error}</FieldError>
      )}
    </Field>
  );
}
