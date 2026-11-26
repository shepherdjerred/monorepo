export type ConnectionState =
  "live" | "connecting" | "reconnecting" | "offline";

export type StatusDotProps = {
  readonly state: ConnectionState;
  /** Overrides the default word: "Live", "Connecting", "Reconnecting", "Offline". */
  readonly label?: string;
};

const DEFAULT_LABEL: Readonly<Record<ConnectionState, string>> = {
  live: "Live",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

/**
 * The live-feed indicator: a dot and a word. The dot is the only round shape
 * in the design; it pulses while connecting or reconnecting (not under
 * reduced motion). The word, never colour alone, carries the state.
 */
export function StatusDot({ state, label }: StatusDotProps): React.JSX.Element {
  return (
    <span className="ui-status-dot" data-state={state} role="status">
      <span className="ui-status-dot-mark" aria-hidden="true" />
      {label ?? DEFAULT_LABEL[state]}
    </span>
  );
}
