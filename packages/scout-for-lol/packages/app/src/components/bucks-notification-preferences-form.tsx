import { useEffect, useRef } from "react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  FormPendingStatus,
  ServerFormError,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";

export type BucksNotificationPreferencesView = {
  ownBetSettlementDms: boolean;
  betsOnPlayerSettlementDms: boolean;
};

/**
 * The two settlement-DM toggles, through the required TanStack Form toolkit.
 * Hydrated from the server values via `form.reset` whenever they change.
 */
export function BucksNotificationPreferencesForm(props: {
  preferences: BucksNotificationPreferencesView;
  pending: boolean;
  error: string | null;
  onSubmit: (preferences: BucksNotificationPreferencesView) => void;
}) {
  const formElement = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: props.preferences,
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => {
      props.onSubmit(value);
    },
  });
  const { ownBetSettlementDms, betsOnPlayerSettlementDms } = props.preferences;
  useEffect(() => {
    form.reset({ ownBetSettlementDms, betsOnPlayerSettlementDms });
  }, [form, ownBetSettlementDms, betsOnPlayerSettlementDms]);

  return (
    <form
      ref={formElement}
      onSubmit={(event) => {
        handleFormSubmit(event, () => form.handleSubmit());
      }}
    >
      <fieldset disabled={props.pending} className="space-y-3">
        <legend className="mb-2 font-medium">Settlement notifications</legend>
        <form.Field name="ownBetSettlementDms">
          {(field) => (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name={field.name}
                checked={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.checked);
                }}
              />
              DM me when my own bets settle
            </label>
          )}
        </form.Field>
        <form.Field name="betsOnPlayerSettlementDms">
          {(field) => (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name={field.name}
                checked={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.checked);
                }}
              />
              DM me when bets on my games settle
            </label>
          )}
        </form.Field>
        <Button type="submit" size="sm">
          Save preferences
        </Button>
      </fieldset>
      <FormPendingStatus pending={props.pending}>
        Saving preferences…
      </FormPendingStatus>
      <ServerFormError error={props.error} />
    </form>
  );
}
