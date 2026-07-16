import { Button, type ButtonProps } from "#src/components/ui/button.tsx";
import { DialogFooter } from "#src/components/ui/dialog.tsx";

/**
 * The inline validation error every mutation dialog renders directly above its
 * footer. Renders nothing when `error` is null so call sites can pass their
 * error state unconditionally.
 */
export function DialogFormError(props: { error: string | null }) {
  if (props.error === null) return null;
  return <p className="text-sm text-destructive">{props.error}</p>;
}

/**
 * The Cancel / submit footer shared by every mutation dialog. The submit button
 * shows `pendingLabel` while `pending`, otherwise `submitLabel`, and is disabled
 * when `pending` or the optional `submitDisabled` predicate is true.
 */
export function DialogFormFooter(props: {
  pending: boolean;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
  submitDisabled?: boolean;
  submitVariant?: ButtonProps["variant"];
}) {
  return (
    <DialogFooter className="gap-2 sm:gap-2">
      <Button type="button" variant="outline" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button
        type="submit"
        variant={props.submitVariant}
        disabled={props.pending || (props.submitDisabled ?? false)}
      >
        {props.pending ? props.pendingLabel : props.submitLabel}
      </Button>
    </DialogFooter>
  );
}
