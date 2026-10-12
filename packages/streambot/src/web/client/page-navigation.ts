import { useEffect, useLayoutEffect } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router";
import { PAGE_TITLES } from "./route-state.ts";

const positions = new Map<string, number>();

/** Restore each browser history entry after asynchronous results have rendered. */
export function usePageNavigation() {
  const location = useLocation();
  const navigation = useNavigationType();
  useEffect(() => {
    const previous = globalThis.history.scrollRestoration;
    globalThis.history.scrollRestoration = "manual";
    return () => {
      globalThis.history.scrollRestoration = previous;
    };
  }, []);
  useLayoutEffect(() => {
    document.title =
      (PAGE_TITLES[location.pathname] ?? "Streambot") + " · Streambot";
    const position =
      navigation === NavigationType.Pop
        ? (positions.get(location.key) ?? globalThis.scrollY)
        : 0;
    let restored = false;
    let focused = navigation === NavigationType.Pop;
    positions.set(location.key, position);
    const restore = () => {
      if (!restored) {
        globalThis.scrollTo(0, position);
        restored =
          document.documentElement.scrollHeight - globalThis.innerHeight >=
          position;
      }
      if (!focused) {
        const heading = document.querySelector<HTMLElement>("#page-heading");
        if (heading !== null) {
          heading.focus({ preventScroll: true });
          focused = true;
        }
      }
    };
    restore();
    const observer = new ResizeObserver(restore);
    observer.observe(document.body);
    const cancelRestore = () => {
      restored = true;
      focused = true;
    };
    const rememberScroll = () => {
      if (restored) positions.set(location.key, globalThis.scrollY);
    };
    globalThis.addEventListener("scroll", rememberScroll, { passive: true });
    globalThis.addEventListener("wheel", cancelRestore, { passive: true });
    globalThis.addEventListener("touchstart", cancelRestore, { passive: true });
    return () => {
      if (positions.size > 100) {
        const first = positions.keys().next().value;
        if (first !== undefined) positions.delete(first);
      }
      observer.disconnect();
      globalThis.removeEventListener("scroll", rememberScroll);
      globalThis.removeEventListener("wheel", cancelRestore);
      globalThis.removeEventListener("touchstart", cancelRestore);
    };
  }, [location.key, location.pathname, navigation]);
}
