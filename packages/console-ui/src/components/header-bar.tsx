import type { ReactNode } from "react";

export type HeaderBarProps = {
  readonly title: ReactNode;
  /** Usually `<Tabs>`, placed right after the title. */
  readonly tabs?: ReactNode;
  /** Muted text, right-aligned (e.g. "Snapshot generated 1m ago"). */
  readonly meta?: ReactNode;
  /** Buttons at the far right. */
  readonly actions?: ReactNode;
};

/** The 48px bar at the top of the panel; the title is the page's `<h1>`. */
export function HeaderBar({
  title,
  tabs,
  meta,
  actions,
}: HeaderBarProps): React.JSX.Element {
  return (
    <header className="ui-header">
      <h1 className="ui-header-title">{title}</h1>
      {tabs}
      {meta === undefined ? null : (
        <span className="ui-header-meta">{meta}</span>
      )}
      {actions === undefined ? null : (
        <div className="ui-header-actions">{actions}</div>
      )}
    </header>
  );
}
