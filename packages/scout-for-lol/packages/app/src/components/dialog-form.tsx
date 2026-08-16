import {
  Button,
  type ButtonProps,
} from "@scout-for-lol/design-system/components/button";
import { DialogFooter } from "@scout-for-lol/design-system/components/dialog";

/**
 * The inline validation error every mutation dialog renders directly above its
 * footer. Renders nothing when `error` is null so call sites can pass their
 * error state unconditionally.
 */
export function DialogFormError(props: { error: string | null }) {
  if (props.error === null) return null;
  return (
    <p role="alert" className="text-sm text-scout-danger">
      {props.error}
    </p>
  );
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
