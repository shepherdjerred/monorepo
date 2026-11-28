import type { ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import {
  plainLink,
  type RenderLinkProps,
} from "@shepherdjerred/console-ui/components/link.tsx";

export type SidebarItemProps = {
  readonly href: string;
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly count?: number | string;
  /**
   * Marks the current page with `aria-current="page"`. A router link that
   * sets `aria-current` itself (react-router's `NavLink`) can leave this unset.
   */
  readonly current?: boolean;
  /** Renders the anchor, e.g. `(props) => <NavLink to={props.href} {...props} />`. */
  readonly renderLink?: (props: RenderLinkProps) => ReactElement;
};

/** One navigation row: `<li><a>` with an icon, a label and an optional count. */
export function SidebarItem({
  href,
  label,
  icon,
  count,
  current = false,
  renderLink = plainLink,
}: SidebarItemProps): React.JSX.Element {
  const Icon = icon;
  return (
    <li>
      {renderLink({
        href,
        className: "ui-nav-item",
        "aria-current": current ? "page" : undefined,
        children: (
          <>
            {Icon === undefined ? null : (
              <Icon className="ui-nav-icon" aria-hidden="true" />
            )}
            <span className="ui-nav-text">{label}</span>
            {count === undefined ? null : (
              <span className="ui-nav-count">{count}</span>
            )}
          </>
        ),
      })}
    </li>
  );
}
