import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Control } from "@shepherdjerred/streambot/web/client/use-control.ts";
import { ChangeStatus } from "./change-status.tsx";
import "@shepherdjerred/streambot/web/client/styles/dialog.css";

/**
 * A native modal dialog around one playlist action: a title, its fields, the action's own status
 * line, and Cancel beside the submit button. The browser makes the page inert, traps focus, closes
 * on Escape and returns focus to the menu. `onSubmit` receives `close` to call once the action
 * succeeds. A dialog with no fields puts focus on Cancel, so Enter never confirms by accident.
 */
export function ActionDialog(props: {
  title: string;
  description?: ReactNode;
  control: Control;
  submit: string;
  pendingLabel: string;
  danger?: boolean;
  cancel?: string;
  onSubmit: (close: () => void) => void;
  onRefresh: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { control } = props;
  const close = () => {
    dialog.current?.close();
  };

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      onClose={props.onClose}
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (control.pending) return;
          props.onSubmit(close);
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {props.title}
        </h2>
        {props.description !== undefined && (
          <p className="muted">{props.description}</p>
        )}
        {props.children}
        <ChangeStatus
          control={control}
          onRefresh={props.onRefresh}
          surface="dialog"
        />
        <div className="dialog-actions btn-row">
          <button type="button" className="btn" onClick={close}>
            {props.cancel ?? "Cancel"}
          </button>
          <button
            type="submit"
            className={props.danger === true ? "btn btn-danger" : "btn"}
            aria-busy={control.pending}
            aria-disabled={control.pending}
          >
            {control.pending ? props.pendingLabel : props.submit}
          </button>
        </div>
      </form>
    </dialog>
  );
}
