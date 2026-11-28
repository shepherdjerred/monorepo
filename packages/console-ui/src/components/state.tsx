import type { ReactNode } from "react";
import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";

export type StateKind = "loading" | "empty" | "error";

export type StateProps = {
  readonly kind: StateKind;
  /** One sentence: "Loading deployments…", "No open alerts.", the error. */
  readonly children: ReactNode;
  /** A button that resolves the state, e.g. Retry or Clear filters. */
  readonly action?: ReactNode;
};

/**
 * The loading, empty or error line that stands where a list or section's
 * content would be. Loading is announced politely; an error leads with its
 * glyph and is announced at once.
 */
export function State({
  kind,
  children,
  action,
}: StateProps): React.JSX.Element {
  return (
    <div
      className="ui-state"
      data-kind={kind}
      role={kind === "error" ? "alert" : "status"}
    >
      {kind === "error" ? <StatusGlyph severity="error" /> : null}
      <span className="ui-state-text">{children}</span>
      {action}
    </div>
  );
}
