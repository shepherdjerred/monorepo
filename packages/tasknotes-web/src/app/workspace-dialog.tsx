import { useEffect, useId, useRef, type ReactNode } from "react";

export function WorkspaceDialog(props: {
  title: string;
  className?: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={props.className}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        props.onDismiss();
      }}
    >
      <div className="sheet">
        <h2 id={titleId} className="visually-hidden">
          {props.title}
        </h2>
        {props.children}
      </div>
    </dialog>
  );
}

export function DecisionDialog(props: {
  title: string;
  detail: string;
  action: string;
  onDecision: () => void;
  onDismiss: () => void;
}) {
  return (
    <WorkspaceDialog
      title={props.title}
      className="decision-dialog"
      onDismiss={props.onDismiss}
    >
      <h2>{props.title}</h2>
      <p>{props.detail}</p>
      <div className="actions">
        <button type="button" className="secondary" onClick={props.onDismiss}>
          Cancel
        </button>
        <button type="button" className="danger" onClick={props.onDecision}>
          {props.action}
        </button>
      </div>
    </WorkspaceDialog>
  );
}
