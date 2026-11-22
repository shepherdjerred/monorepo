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

/** The rendered width of a poster in a rail (`poster-rail.module.css`). */
const RAIL_SIZES = "(min-width: 761px) 168px, 124px";

/** One phrase about a title, on its tone's fill. */
export function StatePill({
  state,
  onArt = false,
  invites = false,
  id,
}: {
  state: Copy;
  /** Pinned to the corner of the poster it sits on. */
  onArt?: boolean;
  /**
   * The phrase offers something to do instead of reporting where the title
   * stands, so it is drawn apart from the tones, with a plus for the dot.
   */
  invites?: boolean;
  id?: string;
}) {
  return (
    <span
      className={onArt ? `${cx("state")} ${cx("onArt")}` : cx("state")}
      data-tone={state.tone}
      data-invites={invites ? "true" : undefined}
      id={id}
    >
      {state.label}
    </span>
  );
}

/**
 * A title as its poster: the art, one phrase saying where the title stands,
 * its name, and a line of detail. The whole card is one link, so it holds no
 * other control. The link is named in the order its words are drawn, state,
 * title, detail and note, so its spoken name starts with the words in sight
 * (WCAG 2.5.3, Label in Name). The spaces between the blocks render nothing;
 * they keep the words apart when the text is read as one string.
 *
 * `state` is null when nothing is known about the title, which is not the
 * same as any state. `note` is a second line of detail for the cards that
 * have something more to say. In a `rail` every card takes the same room
 * whatever its text, so a row of them never changes height.
 */
export function PosterCard({
  to,
  title,
  detail,
  note = null,
  posterPath,
  state,
  invites = false,
  headingLevel = 2,
  layout = "grid",
}: {
  to: To;
  title: string;
  detail: string;
  note?: string | null;
  posterPath: string | null;
  state: Copy | null;
  /** See `StatePill`. */
  invites?: boolean;
  /** One below the heading of the list the card is in. */
  headingLevel?: 2 | 3;
  layout?: "grid" | "rail";
}) {
  const id = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const inRail = layout === "rail";
  const named = [
    ...(state === null ? [] : [`${id}-state`]),
    `${id}-title`,
    `${id}-detail`,
    ...(note === null ? [] : [`${id}-note`]),
  ];
  return (
    <article>
      <Link
        className={inRail ? `${cx("card")} ${cx("inRail")}` : cx("card")}
        to={to}
        aria-labelledby={named.join(" ")}
      >
        <div className={cx("art")}>
          <Poster
            path={posterPath}
            title={title}
            sizes={inRail ? RAIL_SIZES : GRID_SIZES}
          />
          {state !== null && (
            <StatePill
              state={state}
              invites={invites}
              onArt
              id={`${id}-state`}
            />
          )}
        </div>{" "}
        <div className={cx("text")}>
          <Heading className={cx("title")} id={`${id}-title`}>
            {title}
          </Heading>{" "}
          <p className={cx("detail")} id={`${id}-detail`}>
            {detail}
          </p>
          {note !== null && (
            <>
              {" "}
              <p className={cx("note")} id={`${id}-note`}>
                {note}
              </p>
            </>
          )}
        </div>
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
