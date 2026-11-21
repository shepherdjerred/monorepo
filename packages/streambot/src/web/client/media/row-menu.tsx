import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "@shepherdjerred/streambot/web/client/styles/menu.css";

export type MenuItem = {
  readonly key: string;
  readonly label: string;
  readonly onSelect: () => void;
};

/**
 * The `⋯` menu on a row. It is a plain positioned list rather than a popover: the Popover API and
 * focusgroup are not yet Baseline Widely Available, and this needs neither. Arrow keys, Home and
 * End move between items; Escape closes and returns focus to the trigger; Tab or a click outside
 * closes it.
 */
export function RowMenu(props: { label: string; items: readonly MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const enterOnOpen = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    if (enterOnOpen.current)
      menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    // A click or focus anywhere else closes the menu.
    const outside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        menu.current?.contains(target) !== true &&
        trigger.current?.contains(target) !== true
      )
        setOpen(false);
    };
    document.addEventListener("click", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("click", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ];
    const active = document.activeElement;
    const current =
      active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
    const move = (index: number) => {
      event.preventDefault();
      items.at(index % items.length)?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(current + 1);
        break;
      case "ArrowUp":
        move(current - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(-1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div className="menu-anchor">
      <button
        ref={trigger}
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerDown={() => {
          enterOnOpen.current = false;
        }}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            enterOnOpen.current = true;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (open)
                menu.current
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.focus();
              else setOpen(true);
            }
          }
        }}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={props.label}
          className="menu"
          onKeyDown={onMenuKey}
        >
          {props.items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="menu-item"
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
