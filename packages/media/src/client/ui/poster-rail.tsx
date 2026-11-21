import { useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { classNames } from "./class-names.ts";
import styles from "./poster-rail.module.css";

const cx = classNames(styles);

type Edges = { atStart: boolean; atEnd: boolean };

/** Where a scroller rests, within a pixel of either end. */
function edgesOf(list: HTMLElement): Edges {
  const travel = list.scrollWidth - list.clientWidth;
  const position = Math.abs(list.scrollLeft);
  return { atStart: position <= 1, atEnd: position >= travel - 1 };
}

/**
 * One row of poster cards that scrolls sideways: a list, so it reads as
 * "list, 20 items", and its children are `<li>`s holding a `PosterCard`
 * with `layout="rail"`.
 *
 * Scrolling is the browser's own, snapped to the cards. A trackpad, a
 * finger, and Tab through the cards all move it, and nothing listens for
 * the wheel, so the page scrolls down past a rail as it does past anything
 * else. The two buttons are for a mouse with no sideways wheel; they come
 * before the list, so they are reached before the cards they move. A button
 * with nowhere left to go is disabled, and hands focus to the other one if
 * it had it.
 *
 * `label` names the list and the buttons ("Trending this week").
 */
export function PosterRail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [edges, setEdges] = useState<Edges>({ atStart: true, atEnd: false });
  const list = useRef<HTMLUListElement | null>(null);
  const back = useRef<HTMLButtonElement | null>(null);
  const forward = useRef<HTMLButtonElement | null>(null);

  const settle = useCallback(() => {
    if (list.current === null) return;
    const next = edgesOf(list.current);
    // Before the button is disabled, which would drop focus on the page.
    if (next.atStart && document.activeElement === back.current) {
      forward.current?.focus({ preventScroll: true });
    } else if (next.atEnd && document.activeElement === forward.current) {
      back.current?.focus({ preventScroll: true });
    }
    setEdges((shown) =>
      shown.atStart === next.atStart && shown.atEnd === next.atEnd
        ? shown
        : next,
    );
  }, []);

  // The ends depend on the row's width, which the list reports itself.
  const attach = useCallback(
    (element: HTMLUListElement | null) => {
      list.current = element;
      if (element === null) return;
      const observer = new ResizeObserver(settle);
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    },
    [settle],
  );

  function step(direction: -1 | 1) {
    const element = list.current;
    if (element === null) return;
    // Most of a screenful, so the last card seen stays in view; the snap
    // points line the row up on a card.
    element.scrollBy({ left: direction * element.clientWidth * 0.8 });
  }

  return (
    <div className={cx("rail")}>
      <button
        ref={back}
        className={`${cx("step")} ${cx("back")}`}
        type="button"
        aria-label={`Scroll back: ${label}`}
        disabled={edges.atStart}
        onClick={() => {
          step(-1);
        }}
      >
        <ChevronLeftIcon aria-hidden="true" />
      </button>
      <button
        ref={forward}
        className={`${cx("step")} ${cx("forward")}`}
        type="button"
        aria-label={`Scroll forward: ${label}`}
        disabled={edges.atEnd}
        onClick={() => {
          step(1);
        }}
      >
        <ChevronRightIcon aria-hidden="true" />
      </button>
      <ul
        ref={attach}
        className={cx("track")}
        aria-label={label}
        onScroll={settle}
      >
        {children}
      </ul>
    </div>
  );
}

/**
 * Something that takes a rail's place, such as the error state of a row that
 * did not load, in the room the rail would have taken: the rows below it do
 * not move when the rail arrives.
 */
export function PosterRailStandIn({ children }: { children: ReactNode }) {
  return <div className={`${cx("rail")} ${cx("standIn")}`}>{children}</div>;
}
