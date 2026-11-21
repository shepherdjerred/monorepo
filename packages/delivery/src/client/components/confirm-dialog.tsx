import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";

type ConfirmDialogHost = {
  /** The dialog's form, where the open button renders its question. */
  form: HTMLFormElement | null;
  /** The button whose question is open, or null while the dialog is closed. */
  owner: string | null;
  /** The id the question's heading takes, so it names the dialog. */
  heading: string;
  /** Open the dialog on `owner`'s question; a confirmed answer runs `onConfirm`. */
  ask: (owner: string, onConfirm: () => void) => void;
  /** The action a confirmed answer runs, as the open question now defines it. */
  answerWith: (onConfirm: () => void) => void;
  /** Close without confirming when `owner`'s question is the open one. */
  release: (owner: string) => void;
};

const ConfirmDialogContext = createContext<ConfirmDialogHost | null>(null);

/**
 * The one native modal dialog every `ConfirmButton` below it asks through.
 * A page with forty confirm buttons has one `<dialog>`, not forty: the button
 * that opened it renders its own question into the dialog's form. Focus moves
 * into the dialog, Escape cancels, and the browser returns focus to the
 * button that opened it.
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const asking = useRef<{ owner: string; onConfirm: () => void } | null>(null);
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const heading = useId();
  const ask = useCallback((next: string, onConfirm: () => void) => {
    asking.current = { owner: next, onConfirm };
    // The question is in the form before the dialog opens, so the browser
    // finds "Keep as is" to focus.
    flushSync(() => {
      setOwner(next);
    });
    dialog.current?.showModal();
  }, []);
  const answerWith = useCallback((onConfirm: () => void) => {
    if (asking.current !== null) asking.current.onConfirm = onConfirm;
  }, []);
  const release = useCallback((leaving: string) => {
    if (asking.current?.owner === leaving) dialog.current?.close();
  }, []);
  const host = useMemo(
    () => ({ form, owner, heading, ask, answerWith, release }),
    [form, owner, heading, ask, answerWith, release],
  );
  return (
    <ConfirmDialogContext value={host}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby={owner === null ? undefined : heading}
        onClose={(event) => {
          const confirmed = event.currentTarget.returnValue === "confirm";
          event.currentTarget.returnValue = "";
          const asked = asking.current;
          asking.current = null;
          setOwner(null);
          if (confirmed) asked?.onConfirm();
        }}
      >
        <form method="dialog" ref={setForm} />
      </dialog>
    </ConfirmDialogContext>
  );
}

/** What the dialog asks: its heading, the consequences, and the two answers. */
export function ConfirmQuestion({
  heading,
  title,
  children,
  confirmLabel,
  danger,
  onAnswer,
}: {
  heading: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger: boolean;
  /** Runs as the confirming answer is given, before the dialog closes on it. */
  onAnswer?: () => void;
}) {
  return (
    <>
      <h2 id={heading}>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="button-row">
        <button value="cancel" className="secondary-button" autoFocus>
          Keep as is
        </button>
        <button
          value="confirm"
          className={danger ? "primary-button danger" : "primary-button"}
          onClick={onAnswer}
        >
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

/** The route's h1 (`PageHeader`), where focus goes when its own place is gone. */
const PAGE_HEADING = "#main-heading";

/**
 * A button that asks before acting, through the page's one native modal
 * dialog (`ConfirmDialogProvider`): focus moves into it, Escape cancels, and
 * focus returns to the button on close.
 *
 * The button keeps that focus while its confirmed action is `pending`: it
 * reads as disabled and ignores a press, but is not disabled, because a
 * disabled element cannot hold focus and the browser would drop it to the
 * document. When the button leaves the page while focused, focus moves to
 * the page heading, the same place a navigation puts it.
 */
export function ConfirmButton({
  label,
  title,
  children,
  confirmLabel,
  danger = false,
  disabled = false,
  pending = false,
  describedBy,
  name,
  check,
  onConfirm,
}: {
  label: string;
  /**
   * The button's accessible name where several share a label: it starts with
   * the visible label and adds what tells this one apart.
   */
  name?: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** The action is not available: the button can be neither pressed nor focused. */
  disabled?: boolean;
  /** The confirmed action is in flight: the button waits and stays focusable. */
  pending?: boolean;
  /** The id of text that tells this button apart from others with its label. */
  describedBy?: string;
  /**
   * Runs on the press, before the question opens; false keeps the dialog
   * closed, as when an input the action needs is missing and the check has
   * pointed at it.
   */
  check?: () => boolean;
  onConfirm: () => void;
}) {
  const host = useContext(ConfirmDialogContext);
  if (host === null)
    throw new Error("ConfirmButton renders below a ConfirmDialogProvider");
  const id = useId();
  const { ask, answerWith, release } = host;
  const leaving = useCallback(
    (trigger: HTMLButtonElement | null) => () => {
      // A button that leaves the page takes its open question with it; the
      // closing dialog hands focus back to the button first.
      release(id);
      if (trigger !== null && document.activeElement === trigger)
        document.querySelector<HTMLElement>(PAGE_HEADING)?.focus();
    },
    [release, id],
  );
  return (
    <>
      <button
        ref={leaving}
        type="button"
        className={danger ? "secondary-button danger" : "secondary-button"}
        disabled={disabled}
        aria-disabled={pending ? true : undefined}
        aria-describedby={describedBy}
        aria-label={name}
        onClick={() => {
          if (!pending && (check?.() ?? true)) ask(id, onConfirm);
        }}
      >
        {label}
      </button>
      {host.owner === id &&
        host.form !== null &&
        createPortal(
          <ConfirmQuestion
            heading={host.heading}
            title={title}
            confirmLabel={confirmLabel}
            danger={danger}
            // The answer runs the action as this render defines it, as it
            // would from a dialog of the button's own.
            onAnswer={() => {
              answerWith(onConfirm);
            }}
          >
            {children}
          </ConfirmQuestion>,
          host.form,
        )}
    </>
  );
}
