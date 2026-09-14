import { useCallback, useEffect, useRef, useState } from "react";
import { isScrolledToBottom } from "#src/lib/pinned-scroll.ts";

/**
 * Follow the bottom of the page only while the reader is already there.
 *
 * The page body is the scroll container — RootLayout stacks min-h-screen flex
 * columns with no overflow of their own — so pinning is measured against the
 * window. A reader who scrolls up to re-read is never yanked back down by the
 * next streamed token; scrolling back to the bottom re-pins.
 *
 * `pinned` is that same measurement as state, for the one thing not following
 * the bottom needs: an offer to go back. Without it a reader who scrolled up
 * mid-turn gets no signal that the answer moved on and no way back but the
 * scrollbar. It is kept alongside the ref rather than replacing it because
 * `scrollIfPinned` runs on every streamed token and must not wait on a
 * re-render to know where the reader is.
 */
export function usePinnedScroll(): {
  scrollIfPinned: () => void;
  pinned: boolean;
  scrollToBottom: () => void;
} {
  // Optimistic only until the effect below measures; a reader who mounted
  // part-way up is un-pinned before anything can scroll them.
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const measure = (): void => {
      pinnedRef.current = isScrolledToBottom({
        innerHeight: window.innerHeight,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
      });
      setPinned(pinnedRef.current);
    };
    // Measure once on mount: the ref's initial value is a guess, and a scroll
    // event may never come. Browser scroll restoration and links into the
    // middle of a conversation both land here already scrolled away.
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    // Explore changes the document's height without necessarily scrolling it:
    // switching from a long conversation to a short one reuses this component
    // and leaves `scrollY` where it was, so no scroll event fires even though
    // the whole page may now fit. Without this the pill would linger on a page
    // that is already at its bottom.
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  const scrollIfPinned = useCallback((): void => {
    if (pinnedRef.current) {
      // `auto`, not `smooth`: per-token smooth scrolling restarts the
      // animation on every delta and janks the whole stream.
      scrollDocumentToBottom("auto");
    }
  }, []);

  const scrollToBottom = useCallback((): void => {
    // Smooth here, unlike `scrollIfPinned`: one deliberate jump the reader
    // asked for, not a per-token correction whose animation would restart on
    // every delta.
    scrollDocumentToBottom("smooth");
  }, []);

  return { scrollIfPinned, pinned, scrollToBottom };
}

/**
 * The document, never an anchor element inside the transcript.
 *
 * Following the stream used to `scrollIntoView` an anchor at the end of the
 * transcript. That anchor sits above the sticky composer, so aligning it with
 * the viewport bottom stops a few pixels short of the document's — harmless
 * against the pinned slack, but it meant the two ways of reaching the bottom
 * disagreed about where the bottom was. One target for both, and the page no
 * longer needs an empty node in the transcript to aim at.
 */
function scrollDocumentToBottom(behavior: ScrollBehavior): void {
  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior,
  });
}
