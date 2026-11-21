import { FailureNotice } from "./failure-notice.tsx";
import type { Control } from "./use-control.ts";
import "./styles/status.css";

/**
 * The line beside a control that says what it did: a confirmation, or the specific error with a
 * Retry and the trace Reference. It is always rendered so screen readers hear each change.
 */
export function ControlStatus(props: {
  control: Control | null;
  className?: string;
}) {
  const { control } = props;
  const state = control?.state;
  return (
    <div className={"status " + (props.className ?? "")} role="status">
      {state?.status === "done" && state.message !== "" && (
        <span className="status-ok">
          <span aria-hidden="true">✓ </span>
          {state.message}
        </span>
      )}
      {state?.status === "failed" && control !== null && (
        <FailureNotice
          failure={state.failure}
          onRetry={control.retry}
          onDismiss={control.dismiss}
        />
      )}
    </div>
  );
}
