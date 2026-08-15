import { useCallback, useEffect, useRef, type RefObject } from "react";
import { isScrolledToBottom } from "#src/lib/pinned-scroll.ts";

/**
 * Follow the bottom of the page only while the reader is already there.
 *
 * The page body is the scroll container — RootLayout stacks min-h-screen flex
 * columns with no overflow of their own — so pinning is measured against the
 * window. A reader who scrolls up to re-read is never yanked back down by the
 * next streamed token; scrolling back to the bottom re-pins.
 */
export function usePinnedScroll(): {
  bottomRef: RefObject<HTMLDivElement | null>;
  scrollIfPinned: () => void;
} {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // Optimistic only until the effect below measures; a reader who mounted
  // part-way up is un-pinned before anything can scroll them.
  const pinnedRef = useRef(true);

  useEffect(() => {
    const measure = (): void => {
      pinnedRef.current = isScrolledToBottom({
        innerHeight: window.innerHeight,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
      });
    };
    // Measure once on mount: the ref's initial value is a guess, and a scroll
    // event may never come. Browser scroll restoration and links into the
    // middle of a conversation both land here already scrolled away.
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("scroll", measure);
    };
  }, []);

  const scrollIfPinned = useCallback((): void => {
    if (pinnedRef.current) {
      // `auto`, not `smooth`: per-token smooth scrolling restarts the
      // animation on every delta and janks the whole stream.
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, []);

  return { bottomRef, scrollIfPinned };
}
