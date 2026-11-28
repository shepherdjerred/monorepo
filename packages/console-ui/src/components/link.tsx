import type { ReactElement, ReactNode } from "react";

/**
 * What a router link must render to look and behave like a navigation row
 * or a route tab. Pass a `renderLink` that spreads these onto the router's
 * link, e.g. `(props) => <NavLink to={props.href} {...props} />`.
 */
export type RenderLinkProps = {
  readonly href: string;
  readonly className: string;
  readonly "aria-current": "page" | undefined;
  readonly children: ReactNode;
};

/** The default `renderLink`: a plain anchor. */
export function plainLink({
  href,
  className,
  "aria-current": ariaCurrent,
  children,
}: RenderLinkProps): ReactElement {
  return (
    <a href={href} className={className} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}
