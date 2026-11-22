import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

const BUTTON_TEXT: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Copy failed",
};

/**
 * An identifier someone pastes into another tool, such as a Kubernetes Job
 * name or UID: shown whole, selectable as one value, with a button that
 * copies it. The button says whether the copy worked.
 */
export function CopyableIdentifier({
  label,
  value,
}: {
  /** What the value is, so the button's name says what it copies. */
  label: string;
  value: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <span className="copyable">
      <code className="mono copyable-value">{value}</code>
      <button
        type="button"
        className="text-button"
        aria-label={`Copy ${label} ${value}`}
        onClick={() => {
          void copy();
        }}
      >
        <span aria-live="polite">{BUTTON_TEXT[state]}</span>
      </button>
    </span>
  );
}
