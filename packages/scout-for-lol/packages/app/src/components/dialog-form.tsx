import type { ReactNode, RefObject } from "react";
import {
  Button,
  type ButtonProps,
} from "@scout-for-lol/design-system/components/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/dialog";
import {
  FormPendingStatus,
  handleFormSubmit,
} from "#src/components/semantic-form.tsx";

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

/**
 * The semantic shell shared by stateful mutation dialogs. Callers retain their
 * TanStack fields and mutation contracts while the native form, pending
 * fieldset, status, error, and action behavior stay consistent.
 */
export function SemanticDialogForm(props: {
  formRef: RefObject<HTMLFormElement | null>;
  title: ReactNode;
  description: ReactNode;
  pending: boolean;
  pendingStatus: ReactNode;
  error: string | null;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
  children: ReactNode;
  fieldsetClassName?: string;
  submitDisabled?: boolean;
  submitVariant?: ButtonProps["variant"];
}) {
  return (
    <DialogContent>
      <form
        ref={props.formRef}
        className="space-y-4"
        aria-busy={props.pending}
        onSubmit={(event) => {
          handleFormSubmit(event, props.onSubmit);
        }}
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <fieldset
          disabled={props.pending}
          className={props.fieldsetClassName ?? "m-0 border-0 p-0"}
        >
          {props.children}
        </fieldset>
        <DialogFormError error={props.error} />
        <FormPendingStatus pending={props.pending}>
          {props.pendingStatus}
        </FormPendingStatus>
        <DialogFormFooter
          pending={props.pending}
          submitLabel={props.submitLabel}
          pendingLabel={props.pendingLabel}
          onCancel={props.onCancel}
          {...(props.submitDisabled === undefined
            ? {}
            : { submitDisabled: props.submitDisabled })}
          {...(props.submitVariant === undefined
            ? {}
            : { submitVariant: props.submitVariant })}
        />
      </form>
    </DialogContent>
  );
}
