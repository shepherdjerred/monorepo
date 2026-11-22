import { useId, useRef, useState, type ReactNode } from "react";
import { classNames } from "./class-names.ts";
import styles from "./menu.module.css";
import { useDismissal } from "./use-dismissal.ts";

const cx = classNames(styles);

export type MenuItem = {
  key: string;
  label: string;
  /** A line under the label saying what choosing it does. */
  detail?: string;
  onSelect: () => void;
};

/** Brings a list that opened below the screen's edge into view. */
function reveal(list: HTMLUListElement | null) {
  list?.scrollIntoView({ block: "nearest" });
}

/**
 * A button and the short list of actions it discloses.
 *
 * It is a disclosure, not an ARIA menu: the actions are ordinary buttons
 * reached with Tab, which is what a list this short needs. Escape closes it
 * and returns focus to the button; a press or focus anywhere else closes it.
 * Choosing an action closes the list and puts focus back on the button
 * first, so whatever the action opens returns focus there when it closes.
 */
export function Menu({
  label,
  trigger,
  variant = "quiet",
  disabled = false,
  alignEndOnPhone = false,
  items,
}: {
  /** The button's accessible name, when its content is only an icon. */
  label?: string;
  trigger: ReactNode;
  /** `standing` is a filled button that says where the reader stands. */
  variant?: "quiet" | "standing";
  disabled?: boolean;
  /** The list hangs from the button's right edge on a phone. */
  alignEndOnPhone?: boolean;
  items: readonly MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const dismissal = useDismissal(open, setOpen);
  return (
    <div className={cx("root")} ref={dismissal}>
      <button
        className={`${cx("trigger")} ${cx(variant)}`}
        type="button"
        ref={button}
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => {
          setOpen((shown) => !shown);
        }}
      >
        {trigger}
      </button>
      <ul
        className={
          alignEndOnPhone ? `${cx("list")} ${cx("endOnPhone")}` : cx("list")
        }
        id={listId}
        hidden={!open}
        // Keyed by `open`, so the list is revealed each time it opens.
        ref={open ? reveal : undefined}
      >
        {items.map((item) => (
          <li key={item.key}>
            <button
              className={cx("item")}
              type="button"
              onClick={() => {
                setOpen(false);
                button.current?.focus();
                item.onSelect();
              }}
            >
              <span className={cx("itemLabel")}>{item.label}</span>
              {item.detail !== undefined && (
                <span className={cx("itemDetail")}>{item.detail}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
