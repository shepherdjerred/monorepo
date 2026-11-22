import { useId, type ReactNode } from "react";

export type SidebarProps = {
  /** The row above the navigation: an `<AppSwitcher>` and optional `<IconButton>`s. */
  readonly top?: ReactNode;
  /** `<SidebarGroup>`s. */
  readonly children: ReactNode;
  /** Pinned to the bottom, usually a `<ThemeRow>`. */
  readonly footer?: ReactNode;
  readonly navLabel?: string;
};

export function Sidebar({
  top,
  children,
  footer,
  navLabel = "Primary",
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="ui-side">
      {top === undefined ? null : <div className="ui-side-top">{top}</div>}
      <nav className="ui-nav" aria-label={navLabel}>
        {children}
      </nav>
      {footer === undefined ? null : (
        <div className="ui-side-foot">{footer}</div>
      )}
    </aside>
  );
}

export type SidebarGroupProps = {
  readonly label: string;
  /** `<SidebarItem>`s. */
  readonly children: ReactNode;
};

export function SidebarGroup({
  label,
  children,
}: SidebarGroupProps): React.JSX.Element {
  const labelId = useId();
  return (
    <div className="ui-nav-group">
      <p className="ui-nav-label" id={labelId}>
        {label}
      </p>
      <ul className="ui-nav-list" aria-labelledby={labelId}>
        {children}
      </ul>
    </div>
  );
}
