import type { ReactNode } from "react";

export type ShellFrameProps = {
  /** Usually a `<Sidebar>`; hidden below 900px, where the app supplies its own top bar. */
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
};

/**
 * The page frame: a quiet sidebar beside an inset content panel. The document
 * scrolls, never the panel, so page-height measurements see the content.
 */
export function ShellFrame({
  sidebar,
  children,
}: ShellFrameProps): React.JSX.Element {
  return (
    <div className="ui-shell">
      {sidebar}
      <div className="ui-panel">{children}</div>
    </div>
  );
}
