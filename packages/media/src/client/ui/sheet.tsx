import { useCallback, useId, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { classNames } from "./class-names.ts";
import styles from "./sheet.module.css";

const cx = classNames(styles);

/** Whether a pointer event landed outside the dialog's own box. */
function outside(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

/** Closes the sheet a control sits in, as its Cancel and Done buttons do. */
export function closeSheet(control: HTMLElement) {
  control.closest("dialog")?.close();
}

/**
 * A modal sheet: a native `<dialog>` that is open for as long as it is
 * mounted. Render it when it should open and stop rendering it in `onClose`.
 *
 * The browser makes the page behind inert, keeps focus inside, closes on
 * Escape and returns focus to the control that opened it. A press and
 * release on the backdrop closes it too. Focus starts on the element marked
 * `data-autofocus`, or on the first control when there is none.
 *
 * On a phone it rises from the foot of the screen; on a wider screen it is
 * a centred panel.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const show = useCallback((dialog: HTMLDialogElement | null) => {
    if (dialog === null) return;
    if (!dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    // Both the press and the release must be outside, so dragging a text
    // selection out of the sheet does not close it.
    let pressedOutside = false;
    const onDown = (event: PointerEvent) => {
      pressedOutside = outside(event, dialog);
    };
    const onUp = (event: PointerEvent) => {
      if (pressedOutside && outside(event, dialog)) dialog.close();
    };
    dialog.addEventListener("pointerdown", onDown);
    dialog.addEventListener("pointerup", onUp);
    return () => {
      dialog.removeEventListener("pointerdown", onDown);
      dialog.removeEventListener("pointerup", onUp);
    };
  }, []);
  return (
    <dialog
      className={cx("sheet")}
      ref={show}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <header className={cx("header")}>
        <h2 className={cx("title")} id={titleId}>
          {title}
        </h2>
        <button
          className={cx("close")}
          type="button"
          aria-label="Close"
          onClick={(event) => {
            closeSheet(event.currentTarget);
          }}
        >
          <XIcon aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

/** The scrolling part of a sheet, above its actions. */
export function SheetBody({ children }: { children: ReactNode }) {
  return <div className={cx("body")}>{children}</div>;
}

/** The sheet's actions, which stay in view while the body scrolls. */
export function SheetActions({ children }: { children: ReactNode }) {
  return <div className={cx("actions")}>{children}</div>;
}
