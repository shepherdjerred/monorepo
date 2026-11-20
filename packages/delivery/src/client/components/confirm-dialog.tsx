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

/**
 * A button that asks before acting, through the page's one native modal
 * dialog (`ConfirmDialogProvider`): focus moves into it, Escape cancels, and
 * focus returns to the button on close.
 */
export function ConfirmButton({
  label,
  title,
  children,
  confirmLabel,
  danger = false,
  disabled = false,
  describedBy,
  onConfirm,
}: {
  label: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  /** The id of text that tells this button apart from others with its label. */
  describedBy?: string;
  onConfirm: () => void;
}) {
  const host = useContext(ConfirmDialogContext);
  if (host === null)
    throw new Error("ConfirmButton renders below a ConfirmDialogProvider");
  const id = useId();
  const { ask, answerWith, release } = host;
  // A button that leaves the page takes its open question with it.
  const leaving = useCallback(
    () => () => {
      release(id);
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
        aria-describedby={describedBy}
        onClick={() => {
          ask(id, onConfirm);
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
