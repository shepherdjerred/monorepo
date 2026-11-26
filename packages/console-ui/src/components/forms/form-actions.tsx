import type { ReactNode } from "react";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";

export type FormActionsProps = {
  /** The submit button's label: "Save link". */
  readonly submit: string;
  /** While true the button is disabled and reads `pendingLabel`. */
  readonly pending?: boolean;
  readonly pendingLabel?: string;
  /** A Cancel button or link, placed before the submit button. */
  readonly cancel?: ReactNode;
  /** Left-aligned status, e.g. a `SavedStatus`. */
  readonly status?: ReactNode;
};

/** The right-aligned row at the bottom of a form. */
export function FormActions({
  submit,
  pending = false,
  pendingLabel = "Saving…",
  cancel,
  status,
}: FormActionsProps): React.JSX.Element {
  return (
    <div className="ui-form-actions">
      {status === undefined ? null : (
        <div className="ui-form-actions-status">{status}</div>
      )}
      {cancel}
      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        aria-busy={pending ? true : undefined}
      >
        {pending ? pendingLabel : submit}
      </Button>
    </div>
  );
}
