import { useSyncExternalStore } from "react";

/** Tracks a CSS media query; false on the server and before hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = globalThis.matchMedia(query);
      list.addEventListener("change", notify);
      return () => {
        list.removeEventListener("change", notify);
      };
    },
    () => globalThis.matchMedia(query).matches,
    () => false,
  );
}
