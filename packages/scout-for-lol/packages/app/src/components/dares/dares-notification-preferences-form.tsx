import { useEffect, useRef } from "react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  FormPendingStatus,
  ServerFormError,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";

export type DareNotificationPreferencesView = {
  dareLifecycleDms: boolean;
  dareProgressDms: boolean;
};

/**
 * The two settlement-DM toggles, through the required TanStack Form toolkit.
 * Hydrated from the server values via `form.reset` whenever they change.
 */
export function DareNotificationPreferencesForm(props: {
  preferences: DareNotificationPreferencesView;
  pending: boolean;
  error: string | null;
  onSubmit: (preferences: DareNotificationPreferencesView) => void;
}) {
  const formElement = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: props.preferences,
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => {
      props.onSubmit(value);
    },
  });
  const { dareLifecycleDms, dareProgressDms } = props.preferences;
  useEffect(() => {
    form.reset({
      dareLifecycleDms,
      dareProgressDms,
    });
  }, [form, dareLifecycleDms, dareProgressDms]);

  return (
    <form
      ref={formElement}
      onSubmit={(event) => {
        handleFormSubmit(event, () => form.handleSubmit());
      }}
    >
      <fieldset disabled={props.pending} className="space-y-3">
        <legend className="mb-2 font-medium">Dare notifications</legend>
        {(["dareLifecycleDms", "dareProgressDms"] as const).map((name) => (
          <form.Field key={name} name={name}>
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
                {name === "dareLifecycleDms"
                  ? "DM me when a Dare is published, accepted, resolved, or cancelled"
                  : "DM me when a Dare makes material progress"}
              </label>
            )}
          </form.Field>
        ))}
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
