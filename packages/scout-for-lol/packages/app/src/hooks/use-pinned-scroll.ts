import { useCallback, useEffect, useRef, type RefObject } from "react";

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
  const pinnedRef = useRef(true);

  useEffect(() => {
    const onScroll = (): void => {
      pinnedRef.current =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
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
