import { useEffect, useId, useRef, useState } from "react";

/**
 * A comment box. Cmd/Ctrl+Enter sends (never while an IME is composing),
 * Escape cancels. The label is visible so the box is never nameless.
 */
export function Composer({
  label,
  submitLabel = "Comment",
  initial = "",
  autoFocus = false,
  pending = false,
  textareaId,
  onSubmit,
  onCancel,
}: {
  readonly label: string;
  readonly submitLabel?: string;
  readonly initial?: string;
  readonly autoFocus?: boolean;
  readonly pending?: boolean;
  readonly textareaId?: string;
  readonly onSubmit: (body: string) => void;
  readonly onCancel?: (() => void) | undefined;
}): React.JSX.Element {
  const generated = useId();
  const id = textareaId ?? generated;
  const [body, setBody] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const empty = body.trim() === "";

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function send(): void {
    if (empty || pending) return;
    onSubmit(body.trim());
    setBody("");
  }

  return (
    <form
      className="ar-composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={ref}
        rows={3}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          } else if (onCancel !== undefined && event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="ar-composer-actions">
        {onCancel === undefined ? null : (
          <button type="button" className="ui-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="ui-btn"
          data-variant="primary"
          disabled={empty || pending}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
