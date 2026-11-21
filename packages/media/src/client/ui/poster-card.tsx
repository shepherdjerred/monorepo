import { useId, type ReactNode } from "react";
import { Link, type To } from "react-router";
import type { Copy } from "#client/presentation/copy.ts";
import { classNames } from "./class-names.ts";
import { Poster } from "./poster.tsx";
import styles from "./poster-card.module.css";

const cx = classNames(styles);

/**
 * The rendered width of a poster in `PosterGrid`, for the browser's choice
 * among the proxy's image widths: about 160px beside the sidebar, a third of
 * the screen on a phone.
 */
const GRID_SIZES = "(min-width: 761px) 160px, 30vw";

/** One phrase about a title, on its tone's fill. */
export function StatePill({
  state,
  onArt = false,
  id,
}: {
  state: Copy;
  /** Pinned to the corner of the poster it sits on. */
  onArt?: boolean;
  id?: string;
}) {
  return (
    <span
      className={onArt ? `${cx("state")} ${cx("onArt")}` : cx("state")}
      data-tone={state.tone}
      id={id}
    >
      {state.label}
    </span>
  );
}

/**
 * A title as its poster: the art, one phrase saying where the title stands,
 * its name, and a line of detail. The whole card is one link, so it holds no
 * other control. The link is named title first, then state and detail, which
 * is the order a list of links should be heard in, not the order they are
 * drawn in.
 */
export function PosterCard({
  to,
  title,
  detail,
  posterPath,
  state,
}: {
  to: To;
  title: string;
  detail: string;
  posterPath: string | null;
  state: Copy;
}) {
  const id = useId();
  return (
    <article>
      <Link
        className={cx("card")}
        to={to}
        aria-labelledby={`${id}-title ${id}-state ${id}-detail`}
      >
        <div className={cx("art")}>
          <Poster path={posterPath} title={title} sizes={GRID_SIZES} />
          <StatePill state={state} onArt id={`${id}-state`} />
        </div>
        <h2 className={cx("title")} id={`${id}-title`}>
          {title}
        </h2>
        <p className={cx("detail")} id={`${id}-detail`}>
          {detail}
        </p>
      </Link>
    </article>
  );
}

/**
 * Poster cards in as many columns as the space they are given holds: the
 * count follows the grid's own width, not the screen's, so it is right with
 * or without the sidebar.
 */
export function PosterGrid({
  label,
  busy = false,
  children,
}: {
  label: string;
  /** Dims the grid while a newer set of titles is on its way. */
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx("gridFrame")}>
      <ul className={cx("grid")} aria-label={label} aria-busy={busy}>
        {children}
      </ul>
    </div>
  );
}
