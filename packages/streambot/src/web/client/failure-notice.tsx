import type { ApiFailure } from "./api.ts";
import { describeFailure } from "./messages.ts";
import "./styles/status.css";

/** A specific error, with Retry when it can help and the Reference an operator searches for. */
export function FailureNotice(props: {
  failure: ApiFailure;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const copy = describeFailure(props.failure);
  return (
    <span className="status-error">
      <span>{copy.text}</span>
      {copy.retry && props.onRetry !== undefined && (
        <button type="button" className="status-link" onClick={props.onRetry}>
          Retry
        </button>
      )}
      {props.failure.reference !== null && (
        <span className="status-reference">
          Reference <code>{props.failure.reference}</code>
        </span>
      )}
      {props.onDismiss !== undefined && (
        <button
          type="button"
          className="status-link"
          aria-label="Dismiss this message"
          onClick={props.onDismiss}
        >
          Dismiss
        </button>
      )}
    </span>
  );
}
