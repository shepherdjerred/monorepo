import type { ReactNode, RefCallback, RefObject } from "react";
import { Button } from "@shepherdjerred/console-ui";
import {
  SHORT_SLUG_PATTERN,
  type DynamicLinkKind,
  type LinkItem,
} from "#shared/contract.ts";
import { describeDynamicKind } from "./directory-sections.tsx";
import {
  syncShortInputValidity,
  syncTargetInputValidity,
} from "./validation.ts";

export type FormMode =
  | { kind: "create" }
  | { kind: "edit"; short: string }
  | {
      kind: "override";
      short: string;
      dynamicKind: DynamicLinkKind;
      previousTargetUrl: string;
    };

function noop(): void {
  // The form dialog keeps no state of its own to reset on close.
}

function describeFormHeading(mode: FormMode): string {
  switch (mode.kind) {
    case "create": {
      return "New link";
    }
    case "edit": {
      return `Edit go/${mode.short}`;
    }
    case "override": {
      return `Override go/${mode.short}`;
    }
  }
}

const openers = new WeakMap<HTMLDialogElement, Element | null>();

/**
 * Opens a dialog modally and remembers the focused element, so closing it (by
 * button, Escape or backdrop) returns focus to whatever opened it.
 */
export function showModalFromFocus(dialog: HTMLDialogElement | null): void {
  if (dialog === null || dialog.open) {
    return;
  }
  openers.set(dialog, document.activeElement);
  dialog.showModal();
}

/**
 * A native modal `<dialog>`. The browser provides the focus trap and Escape;
 * the parent opens it with `showModalFromFocus` from an event handler.
 */
export function ModalDialog({
  dialogRef,
  labelledBy,
  busy,
  onClose,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  labelledBy: string;
  /** While a request runs the dialog cannot be dismissed, so a late result never closes a newer opening. */
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      className="golink-dialog"
      aria-labelledby={labelledBy}
      onClose={(event) => {
        const opener = openers.get(event.currentTarget);
        if (opener instanceof HTMLElement && opener.isConnected) {
          opener.focus();
        }
        onClose();
      }}
      onCancel={(event) => {
        if (busy) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (!busy && event.target === event.currentTarget) {
          event.currentTarget.close();
        }
      }}
    >
      <div className="golink-dialog-body">{children}</div>
    </dialog>
  );
}

export function MissingSlugBanner({
  slug,
  writesEnabled,
  onCreate,
  onDismiss,
}: {
  slug: string;
  writesEnabled: boolean;
  onCreate: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="ui-banner golink-missing" data-sev="info" role="status">
      <span>
        <code className="golink-short">go/{slug}</code> does not exist yet.
      </span>
      <span className="golink-banner-actions">
        {writesEnabled && (
          <Button size="page" variant="primary" onClick={onCreate}>
            Create go/{slug}
          </Button>
        )}
        <Button size="page" onClick={onDismiss}>
          Dismiss
        </Button>
      </span>
    </div>
  );
}

export function DeleteConfirmDialog({
  dialogRef,
  item,
  isDeleting,
  onConfirm,
  onClose,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  item: LinkItem | null;
  isDeleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ModalDialog
      dialogRef={dialogRef}
      labelledBy="delete-dialog-title"
      busy={isDeleting}
      onClose={onClose}
    >
      <h2 className="golink-dialog-title" id="delete-dialog-title">
        {item === null ? "Delete link" : `Delete go/${item.short}?`}
      </h2>
      {item !== null && (
        <p className="golink-dialog-text">
          It currently points to{" "}
          <span className="ui-mono golink-wrap">{item.targetUrl}</span>.
        </p>
      )}
      <div className="golink-dialog-actions">
        <Button
          size="page"
          disabled={isDeleting}
          onClick={() => {
            dialogRef.current?.close();
          }}
        >
          Cancel
        </Button>
        <Button
          size="page"
          className="golink-danger"
          disabled={isDeleting}
          onClick={onConfirm}
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </ModalDialog>
  );
}

export function LinkFormDialog({
  dialogRef,
  formMode,
  writesEnabled,
  shortValue,
  targetValue,
  shortErrorText,
  targetErrorText,
  isSubmitting,
  mutationError,
  formRef,
  shortInputRef,
  targetInputRef,
  onShortValueChange,
  onTargetValueChange,
  onShortErrorChange,
  onTargetErrorChange,
  onSubmit,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  formMode: FormMode;
  writesEnabled: boolean;
  shortValue: string;
  targetValue: string;
  shortErrorText: string;
  targetErrorText: string;
  isSubmitting: boolean;
  mutationError: string | null;
  formRef: RefCallback<HTMLFormElement>;
  shortInputRef: RefObject<HTMLInputElement | null>;
  targetInputRef: RefObject<HTMLInputElement | null>;
  onShortValueChange: (value: string) => void;
  onTargetValueChange: (value: string) => void;
  onShortErrorChange: (message: string) => void;
  onTargetErrorChange: (message: string) => void;
  onSubmit: () => void;
}) {
  return (
    <ModalDialog
      dialogRef={dialogRef}
      labelledBy="upsert-form-heading"
      busy={isSubmitting}
      onClose={noop}
    >
      <h2 className="golink-dialog-title" id="upsert-form-heading">
        {describeFormHeading(formMode)}
      </h2>
      {formMode.kind === "override" && (
        <p className="golink-dialog-text">
          Currently resolves via{" "}
          <strong>{describeDynamicKind(formMode.dynamicKind)}</strong> to{" "}
          <span className="ui-mono golink-wrap">
            {formMode.previousTargetUrl}
          </span>
          . A manual link takes precedence.
        </p>
      )}

      <form
        ref={formRef}
        method="post"
        action="/api/links"
        className="golink-form"
        aria-labelledby="upsert-form-heading"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="ui-field">
          <label className="ui-field-label" htmlFor="short-input">
            Shortlink name
          </label>
          <div className="golink-slug">
            <span className="golink-slug-prefix ui-mono" aria-hidden="true">
              go/
            </span>
            <input
              ref={shortInputRef}
              id="short-input"
              name="short"
              type="text"
              className="ui-input"
              required
              pattern={SHORT_SLUG_PATTERN}
              maxLength={64}
              placeholder="grafana"
              value={shortValue}
              disabled={!writesEnabled}
              readOnly={formMode.kind !== "create"}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              aria-describedby="short-hint"
              data-error="short-error"
              onChange={(event) => {
                onShortValueChange(event.target.value);
                onShortErrorChange(syncShortInputValidity(event.target));
              }}
              onBlur={(event) => {
                onShortErrorChange(syncShortInputValidity(event.target));
              }}
            />
          </div>
          <p id="short-hint" className="ui-field-hint">
            1–64 letters, numbers, dots, hyphens, or underscores.
          </p>
          <p id="short-error" className="ui-field-error golink-error">
            {shortErrorText}
          </p>
        </div>

        <div className="ui-field">
          <label className="ui-field-label" htmlFor="target-input">
            Destination URL
          </label>
          <input
            ref={targetInputRef}
            id="target-input"
            name="targetUrl"
            type="url"
            className="ui-input"
            required
            placeholder="https://grafana.tailnet-1a49.ts.net"
            value={targetValue}
            disabled={!writesEnabled}
            autoComplete="url"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            aria-describedby="target-hint"
            data-error="target-error"
            onChange={(event) => {
              onTargetValueChange(event.target.value);
              onTargetErrorChange(syncTargetInputValidity(event.target));
            }}
            onBlur={(event) => {
              onTargetErrorChange(syncTargetInputValidity(event.target));
            }}
          />
          <p id="target-hint" className="ui-field-hint">
            Full https:// or http:// address.
          </p>
          <p id="target-error" className="ui-field-error golink-error">
            {targetErrorText}
          </p>
        </div>

        {mutationError !== null && (
          <p className="ui-banner" data-sev="error" role="alert">
            {mutationError}
          </p>
        )}

        <div className="golink-dialog-actions">
          <Button
            size="page"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              dialogRef.current?.close();
            }}
          >
            Cancel
          </Button>
          <Button
            size="page"
            type="submit"
            variant="primary"
            disabled={!writesEnabled || isSubmitting}
          >
            {isSubmitting ? "Saving…" : "Save link"}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
