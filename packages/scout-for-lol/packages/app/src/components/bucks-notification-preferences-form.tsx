import { useEffect, useRef, useState } from "react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  FormPendingStatus,
  ServerFormError,
  handleFormSubmit,
} from "#src/components/semantic-form.tsx";

export type BucksNotificationPreferencesView = {
  ownBetSettlementDms: boolean;
  betsOnPlayerSettlementDms: boolean;
};

/**
 * The two settlement-DM toggles, as a small semantic form with native
 * checkboxes. Hydrated from the server values whenever they change.
 */
export function BucksNotificationPreferencesForm(props: {
  preferences: BucksNotificationPreferencesView;
  pending: boolean;
  error: string | null;
  onSubmit: (preferences: BucksNotificationPreferencesView) => void;
}) {
  const formElement = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(props.preferences);
  const { ownBetSettlementDms, betsOnPlayerSettlementDms } = props.preferences;
  useEffect(() => {
    setValues({ ownBetSettlementDms, betsOnPlayerSettlementDms });
  }, [ownBetSettlementDms, betsOnPlayerSettlementDms]);

  return (
    <form
      ref={formElement}
      onSubmit={(event) => {
        handleFormSubmit(event, () => {
          props.onSubmit(values);
          return Promise.resolve();
        });
      }}
    >
      <fieldset disabled={props.pending} className="space-y-3">
        <legend className="mb-2 font-medium">Settlement notifications</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="ownBetSettlementDms"
            checked={values.ownBetSettlementDms}
            onChange={(event) => {
              setValues((current) => ({
                ...current,
                ownBetSettlementDms: event.target.checked,
              }));
            }}
          />
          DM me when my own bets settle
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="betsOnPlayerSettlementDms"
            checked={values.betsOnPlayerSettlementDms}
            onChange={(event) => {
              setValues((current) => ({
                ...current,
                betsOnPlayerSettlementDms: event.target.checked,
              }));
            }}
          />
          DM me when bets on my games settle
        </label>
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
