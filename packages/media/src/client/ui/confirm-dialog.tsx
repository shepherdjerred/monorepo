import { useId, type ReactNode, type Ref } from "react";
import { Button } from "./button.tsx";
import { classNames } from "./class-names.ts";
import styles from "./confirm-dialog.module.css";

const cx = classNames(styles);

/**
 * Asks before an action that cannot be taken back. Open it with
 * `ref.current.showModal()`.
 *
 * It is a native modal dialog: the browser keeps focus inside it, closes it
 * on Escape or the back gesture, and returns focus to whatever opened it.
 * Cancel comes first, so it is what takes focus and what Enter chooses.
 * `onConfirm` runs only when the confirm button closed the dialog.
 */
export function ConfirmDialog({
  ref,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  ref: Ref<HTMLDialogElement>;
  title: string;
  /** What will happen, naming the thing it happens to. */
  children: ReactNode;
  /** The action itself, as on the button that opened the dialog. */
  confirmLabel: string;
  cancelLabel?: string;
  /** The action destroys or replaces something. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <dialog
      className={cx("dialog")}
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={(event) => {
        const confirmed = event.currentTarget.returnValue === "confirm";
        // Escape sets no value, and not every browser clears the last one.
        event.currentTarget.returnValue = "";
        if (confirmed) onConfirm();
        else onCancel?.();
      }}
    >
      <form className={cx("content")} method="dialog">
        <h2 className={cx("title")} id={titleId}>
          {title}
        </h2>
        <div className={cx("body")} id={bodyId}>
          {children}
        </div>
        <div className={cx("actions")}>
          <Button type="submit" value="cancel">
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            value="confirm"
            variant={danger ? "danger" : "primary"}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
