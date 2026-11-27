import type { MouseEvent } from "react";
import { useHref, useNavigate } from "react-router";

type SpaLinkProps = {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * `href` and `onClick` for a design-system row that renders its own anchor.
 *
 * The row keeps a real `href` (the router's basename included), so opening it
 * in a new tab or copying the link works. A plain click is taken over by the
 * router instead of reloading the page.
 */
export function useSpaLink(to: string): SpaLinkProps {
  const href = useHref(to);
  const navigate = useNavigate();
  return {
    href,
    onClick(event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      void navigate(to);
    },
  };
}
