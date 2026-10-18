import { useId, useRef, type ReactNode } from "react";

/**
 * A button that asks before acting, using a native modal dialog: focus moves
 * into it, Escape cancels, and focus returns to the button on close.
 */
export function ConfirmButton({
  label,
  title,
  children,
  confirmLabel,
  danger = false,
  disabled = false,
  onConfirm,
}: {
  label: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  return (
    <>
      <button
        type="button"
        className={danger ? "secondary-button danger" : "secondary-button"}
        disabled={disabled}
        onClick={() => {
          dialog.current?.showModal();
        }}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={heading}
        onClose={(event) => {
          if (event.currentTarget.returnValue === "confirm") onConfirm();
          event.currentTarget.returnValue = "";
        }}
      >
        <form method="dialog">
          <h2 id={heading}>{title}</h2>
          <div className="dialog-body">{children}</div>
          <div className="button-row">
            <button value="cancel" className="secondary-button" autoFocus>
              Keep as is
            </button>
            <button
              value="confirm"
              className={danger ? "primary-button danger" : "primary-button"}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
