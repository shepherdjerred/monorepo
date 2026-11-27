import { Link, type LinkProps } from "react-router";

/**
 * A router link drawn as the page kit's button, for navigation among a page's
 * actions (`Button` is for things that act, not for going somewhere).
 */
export function LinkButton({
  children,
  ...props
}: Omit<LinkProps, "className">): React.JSX.Element {
  return (
    <Link {...props} className="ui-btn" data-size="page">
      {children}
    </Link>
  );
}
