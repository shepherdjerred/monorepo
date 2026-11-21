import { useEffect, useRef, useState, type ReactNode } from "react";

/** How long an armed confirm waits before it quietly disarms. */
const ARMED_MS = 5000;

/**
 * A destructive control that asks in place: the first press arms it and moves focus to a
 * confirm button beside a Keep button; the second press acts. Escape, Keep, leaving the pair, or
 * five seconds without a choice disarm it. Nothing happens on the first press.
 */
export function ConfirmButton(props: {
  /** What the control does, e.g. "Stop and clear this player". */
  label: string;
  /** The visible content of the unarmed button (an icon or a short word). */
  children: ReactNode;
  /** The visible text of the armed confirm button, e.g. "Stop". */
  confirm: string;
  onConfirm: () => void;
  pending: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);

  useEffect(() => {
    if (armed) {
      confirmButton.current?.focus();
      const timer = setTimeout(() => {
        setArmed(false);
      }, ARMED_MS);
      return () => {
        clearTimeout(timer);
      };
    }
    if (restore.current) {
      restore.current = false;
      trigger.current?.focus();
    }
    return;
  }, [armed]);

  const disarm = (refocus: boolean) => {
    restore.current = refocus;
    setArmed(false);
  };

  if (!armed)
    return (
      <button
        ref={trigger}
        type="button"
        className={props.className ?? "btn"}
        aria-label={props.label}
        title={props.label}
        aria-busy={props.pending}
        disabled={props.pending || props.disabled === true}
        onClick={() => {
          setArmed(true);
        }}
      >
        {props.children}
      </button>
    );
  return (
    <span
      className="confirm"
      role="group"
      aria-label={props.label + "?"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          disarm(true);
        }
      }}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          disarm(false);
      }}
    >
      <button
        ref={confirmButton}
        type="button"
        className="btn btn-small btn-danger"
        onClick={() => {
          disarm(true);
          props.onConfirm();
        }}
      >
        {props.confirm}
      </button>
      <button
        type="button"
        className="btn btn-small btn-ghost"
        onClick={() => {
          disarm(true);
        }}
      >
        Keep
      </button>
    </span>
  );
}
