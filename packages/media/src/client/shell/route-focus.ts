import { useCallback, useRef } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router";

/**
 * Focuses the page's heading. A page that is still loading has none yet:
 * focus waits on the region and moves on when the heading arrives, unless
 * the user has moved it themselves. Returns how to stop waiting.
 *
 * Focus never scrolls: scroll position belongs to `ScrollRestoration`.
 */
function focusPageHeading(region: HTMLElement): () => void {
  const observer = new MutationObserver(() => {
    const arrived = region.querySelector<HTMLElement>("h1");
    if (arrived === null) return;
    observer.disconnect();
    if (document.activeElement === region) {
      arrived.focus({ preventScroll: true });
    }
  });
  const heading = region.querySelector<HTMLElement>("h1");
  if (heading === null) {
    region.focus({ preventScroll: true });
    observer.observe(region, { childList: true, subtree: true });
  } else {
    heading.focus({ preventScroll: true });
  }
  return () => {
    observer.disconnect();
  };
}

/**
 * A ref for the main region. After a navigation to another page it moves
 * focus to that page's heading, so a keyboard or screen-reader user starts
 * at the new content and not at the link they followed.
 *
 * React re-attaches a ref whose identity changed, after the new page is in
 * the document. The page the shell first shows is left alone, and so is a
 * redirect on its own: opening `/` must not put a focus ring on Discover's
 * heading. A redirect that finishes a navigation the person made (a link to
 * an address that moved) finds focus already waiting on the region and
 * carries it to the heading.
 */
export function useRouteFocus() {
  const { pathname } = useLocation();
  const navigation = useNavigationType();
  const shown = useRef(pathname);
  return useCallback(
    (region: HTMLElement | null) => {
      if (region === null || shown.current === pathname) return;
      shown.current = pathname;
      if (
        navigation === NavigationType.Replace &&
        document.activeElement !== region
      ) {
        return;
      }
      return focusPageHeading(region);
    },
    [pathname, navigation],
  );
}
