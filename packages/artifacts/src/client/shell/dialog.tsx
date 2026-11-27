import { useEffect, useId, useRef } from "react";

/**
 * A native modal `<dialog>`: the browser makes the page inert, traps focus and
 * returns it to the opener on close. A click on the backdrop closes it.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Closing from here fires a native `close` event later; it must not close a
  // dialog that was opened again in between.
  const closedByUs = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      closedByUs.current = true;
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ar-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        if (closedByUs.current) {
          closedByUs.current = false;
          return;
        }
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {open ? children : null}
    </dialog>
  );
}
