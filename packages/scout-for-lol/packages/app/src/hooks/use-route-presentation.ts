import { useEffect, useRef } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router";

const positions = new Map<string, number>();

/** Search edits keep their place; page navigation starts at the page heading. */
export function useRoutePresentation() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const navigation = useRef(navigationType);
  navigation.current = navigationType;
  useEffect(() => {
    const prior = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = prior;
    };
  }, []);
  useEffect(() => {
    const type = navigation.current;
    const target =
      type === NavigationType.Pop ? (positions.get(pathname) ?? 0) : 0;
    let restored = false;
    let frame = 0;
    function update() {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (heading === null) return;
      document.title = `${heading.textContent} · Scout`;
      if (restored) return;
      if (document.documentElement.scrollHeight < target + innerHeight) return;
      heading.tabIndex = -1;
      if (type !== NavigationType.Pop) heading.focus({ preventScroll: true });
      window.scrollTo({ top: target, behavior: "instant" });
      restored = true;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const resize = new ResizeObserver(update);
    resize.observe(document.body);
    frame = requestAnimationFrame(update);
    let y = target;
    const record = () => {
      if (restored) y = window.scrollY;
    };
    window.addEventListener("scroll", record, { passive: true });
    return () => {
      positions.set(pathname, y);
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", record);
    };
    // Same-path tab and filter changes must not reset scrolling or focus.
  }, [pathname]);
}
