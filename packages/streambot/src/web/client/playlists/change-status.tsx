import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import type { FailureSurface } from "@shepherdjerred/streambot/web/client/telemetry/events.ts";
import type { Control } from "@shepherdjerred/streambot/web/client/use-control.ts";

/**
 * The status line beside an edit. A `playlist_changed` refusal means someone else edited the
 * playlist after this page loaded, so its answer is a Refresh that reloads the items rather than
 * a Retry that would repeat the stale edit.
 */
export function ChangeStatus(props: {
  control: Control | null;
  onRefresh: () => void;
  className?: string;
  surface?: FailureSurface;
}) {
  const { control } = props;
  const state = control?.state;
  if (
    control !== null &&
    state?.status === "failed" &&
    state.failure.code === "playlist_changed"
  )
    return (
      <div className={"status " + (props.className ?? "")} role="status">
        <span className="status-error">
          <span>{state.failure.message}</span>
          <button
            type="button"
            className="status-link"
            onClick={() => {
              props.onRefresh();
              control.dismiss();
            }}
          >
            Refresh
          </button>
          {state.failure.reference !== null && (
            <span className="status-reference">
              Reference <code>{state.failure.reference}</code>
            </span>
          )}
        </span>
      </div>
    );
  return (
    <ControlStatus
      control={control}
      {...(props.className === undefined ? {} : { className: props.className })}
      {...(props.surface === undefined ? {} : { surface: props.surface })}
    />
  );
}
