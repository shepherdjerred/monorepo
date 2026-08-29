import { useRef } from "react";
import { formatInteger } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  FormPendingStatus,
  ServerFormError,
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import {
  BUCKS_QUICK_STAKES,
  bucksStakeFormSchema,
} from "#src/lib/bucks-forms.ts";

export type BucksBetSubmission = { side: string; stake: number };

/**
 * The shared stake form for every Bryan Bucks market: a native radio group for
 * the market's two sides (labels arrive from the server verbatim) and a whole-
 * number stake. Native constraints own required/min/step; Zod owns the
 * cross-field balance rule; the server remains the authority and answers
 * refusals through `serverError`.
 */
export function BucksBetForm(props: {
  idPrefix: string;
  sideOptions: { value: string; label: string }[];
  balance: number;
  pending: boolean;
  serverError: string | null;
  submitLabel?: string;
  onSubmit: (submission: BucksBetSubmission) => void;
}) {
  const formElement = useRef<HTMLFormElement>(null);
  const schema = bucksStakeFormSchema(props.balance);
  const form = useScoutForm({
    defaultValues: { side: "", stake: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => {
      const parsed = schema.parse(value);
      props.onSubmit({ side: parsed.side, stake: parsed.stake });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  return (
    <form.AppForm>
      <form
        ref={formElement}
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <fieldset
          disabled={props.pending}
          className="flex flex-wrap items-end gap-4"
        >
          <form.Field name="side">
            {(field) => (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-scout-subtle text-sm">Side</legend>
                <div className="flex gap-3">
                  {props.sideOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        type="radio"
                        name={field.name}
                        value={option.value}
                        required
                        checked={field.state.value === option.value}
                        onChange={() => {
                          field.handleChange(option.value);
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </form.Field>
          <form.AppField name="stake">
            {(field) => (
              <field.TextField
                id={`${props.idPrefix}-stake`}
                label="Stake (BB)"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                autoComplete="off"
                fieldClassName="w-32"
              />
            )}
          </form.AppField>
          <div className="flex items-center gap-2">
            {BUCKS_QUICK_STAKES.map((stake) => (
              <Button
                key={stake}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  form.setFieldValue("stake", stake.toString());
                  // requestSubmit (never form.submit) so native validation and
                  // submitter behaviour still run.
                  formElement.current?.requestSubmit();
                }}
              >
                {formatInteger(stake)} BB
              </Button>
            ))}
            <Button type="submit" size="sm">
              {props.submitLabel ?? "Place bet"}
            </Button>
          </div>
        </fieldset>
        <FormPendingStatus pending={props.pending}>
          Placing bet…
        </FormPendingStatus>
        <ServerFormError error={props.serverError} />
      </form>
    </form.AppForm>
  );
}
