import { useCallback, type ReactNode } from "react";

export type HeaderBarProps = {
  readonly title: ReactNode;
  /** Before the title: a back link or a breadcrumb trail. */
  readonly lead?: ReactNode;
  /**
   * `id` of the `<h1>`, e.g. for `aria-labelledby` or to return focus to
   * the title after a dialog closes.
   */
  readonly titleId?: string;
  /**
   * `p` when the page draws its own `<h1>` below the bar (an editable
   * title, say), so the page keeps one top heading. Defaults to `h1`.
   */
  readonly titleAs?: "h1" | "p";
  /** Usually `<Tabs>` or `<NavTabs>`, placed right after the title. */
  readonly tabs?: ReactNode;
  /** Muted text, right-aligned (e.g. "Snapshot generated 1m ago"). */
  readonly meta?: ReactNode;
  /** Buttons at the far right. */
  readonly actions?: ReactNode;
  /**
   * Moves focus to the title when the bar mounts, so a screen reader
   * announces the new page after client-side navigation. Give the page a
   * `key` per route to refocus on every navigation.
   */
  readonly focusOnMount?: boolean;
};

/**
 * The 48px bar at the top of the panel; the title is the page's `<h1>`. It
 * wraps onto more lines at phone width rather than overflowing.
 */
export function HeaderBar({
  title,
  lead,
  titleId,
  titleAs = "h1",
  tabs,
  meta,
  actions,
  focusOnMount = false,
}: HeaderBarProps): React.JSX.Element {
  const Title = titleAs;
  // A stable ref callback runs once when the title mounts.
  const focusTitle = useCallback(
    (element: HTMLElement | null) => {
      if (focusOnMount) element?.focus();
    },
    [focusOnMount],
  );
  return (
    <header className="ui-header">
      {lead === undefined ? null : <div className="ui-header-lead">{lead}</div>}
      <Title
        className="ui-header-title"
        id={titleId}
        ref={focusTitle}
        tabIndex={focusOnMount || titleId !== undefined ? -1 : undefined}
      >
        {title}
      </Title>
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
