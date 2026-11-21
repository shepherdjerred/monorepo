import { useCallback, useSyncExternalStore } from "react";

/** Rendered without a screen (a test's `renderToString`), nothing matches. */
function withoutScreen(): boolean {
  return false;
}

/**
 * Whether a media query matches, kept current as the screen changes.
 *
 * For the few choices CSS cannot make: which of two layouts a page builds
 * when their markup differs. Prefer a container or media query in a
 * stylesheet whenever one layout can be restyled into the other.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = globalThis.matchMedia(query);
      list.addEventListener("change", notify);
      return () => {
        list.removeEventListener("change", notify);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia(query).matches,
    withoutScreen,
  );
}
