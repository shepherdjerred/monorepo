import { Fragment, type ReactElement } from "react";
import {
  plainLink,
  type RenderLinkProps,
} from "@shepherdjerred/console-ui/components/link.tsx";

export type NavTabItem = {
  readonly href: string;
  readonly label: string;
  readonly count?: number | string;
  /** Marks the tab for the route on screen. */
  readonly current: boolean;
};

export type NavTabsProps = {
  /** Names the navigation landmark, e.g. "Deployment views". */
  readonly label: string;
  readonly items: readonly NavTabItem[];
  /** Renders each anchor, e.g. `(props) => <Link to={props.href} {...props} />`. */
  readonly renderLink?: (props: RenderLinkProps) => ReactElement;
};

/**
 * Route tabs: links between sibling pages, drawn exactly like `Tabs`. Use
 * `Tabs` to filter one view in place and `NavTabs` when each tab is a URL.
 */
export function NavTabs({
  label,
  items,
  renderLink = plainLink,
}: NavTabsProps): React.JSX.Element {
  return (
    <nav className="ui-tabs" aria-label={label}>
      {items.map((item) => (
        <Fragment key={item.href}>
          {renderLink({
            href: item.href,
            className: "ui-tab",
            "aria-current": item.current ? "page" : undefined,
            children: (
              <>
                {item.label}
                {item.count === undefined ? null : (
                  <span className="ui-tab-count">{item.count}</span>
                )}
              </>
            ),
          })}
        </Fragment>
      ))}
    </nav>
  );
}
