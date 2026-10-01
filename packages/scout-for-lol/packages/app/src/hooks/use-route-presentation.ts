import { useEffect, useRef } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router";

const positions = new Map<string, number>();

/** Search edits keep their place; page navigation starts at the page heading. */
export function useRoutePresentation() {
  const { pathname, key } = useLocation();
  const navigationType = useNavigationType();
  const previous = useRef<{ pathname: string; key: string } | null>(null);
  useEffect(() => {
    const prior = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = prior;
    };
  }, []);
  useEffect(() => {
    const type = navigationType;
    const samePage =
      previous.current?.pathname === pathname && previous.current.key !== key;
    previous.current = { pathname, key };
    const keepPlace = samePage && type !== NavigationType.Pop;
    const target =
      type === NavigationType.Pop
        ? (positions.get(key) ?? window.scrollY)
        : keepPlace
          ? window.scrollY
          : 0;
    let restored = keepPlace;
    let allowClamp = false;
    let y = target;
    let frame = 0;
    function update() {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (heading !== null) document.title = `${heading.textContent} · Scout`;
      if (restored) return;
      if (
        !allowClamp &&
        (heading === null ||
          document.documentElement.scrollHeight < target + innerHeight)
      )
        return;
      if (heading !== null) {
        heading.tabIndex = -1;
        if (!samePage && type !== NavigationType.Pop)
          heading.focus({ preventScroll: true });
      }
      window.scrollTo({ top: target, behavior: "instant" });
      y = window.scrollY;
      restored = true;
    }
    if (!keepPlace) window.scrollTo({ top: 0, behavior: "instant" });
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const resize = new ResizeObserver(update);
    resize.observe(document.body);
    update();
    const timeout = globalThis.setTimeout(() => {
      allowClamp = true;
      update();
    }, 2000);
    const record = () => {
      if (restored) y = window.scrollY;
    };
    window.addEventListener("scroll", record, { passive: true });
    return () => {
      positions.set(key, y);
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      globalThis.clearTimeout(timeout);
      window.removeEventListener("scroll", record);
    };
    // Same-path tab and filter changes must not reset scrolling or focus.
  }, [pathname, key, navigationType]);
}
