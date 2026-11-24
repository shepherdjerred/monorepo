import { CheckIcon } from "lucide-react";
import { Link } from "react-router";
import type { CalendarEvent } from "#shared/household/calendar.ts";
import { AVAILABILITY_COPY } from "#client/presentation/availability.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import { StatePill } from "#client/ui/poster-card.tsx";
import { useOpensTitle } from "#client/ui/motion/title-transition.ts";
import styles from "./calendar.module.css";
import { releaseDetail, releaseShortDetail, releaseTitle } from "./events.ts";

const cx = classNames(styles);

/** A release's title page: the series for an episode, the film itself. */
function titleAddress(event: CalendarEvent): string {
  return `/media/${encodeURIComponent(event.rootMediaId)}`;
}

/** One release as a row of a list: poster, title, what it is, where it stands. */
function ReleaseRow({ event }: { event: CalendarEvent }) {
  const opens = useOpensTitle(
    titleAddress(event),
    { path: event.artwork.posterPath, title: releaseTitle(event) },
    `row ${event.id}`,
  );
  return (
    <li className={cx("release")}>
      <div className={cx("releasePoster")}>
        <Poster
          path={event.artwork.posterPath}
          title={releaseTitle(event)}
          sizes="44px"
          carries={opens.carries}
        />
      </div>
      <div className={cx("releaseText")}>
        <Link
          className={cx("releaseLink")}
          to={titleAddress(event)}
          {...opens.link}
        >
          {releaseTitle(event)}
        </Link>
        <p className={cx("releaseDetail")}>{releaseDetail(event)}</p>
      </div>
      <div className={cx("releaseState")}>
        <StatePill state={AVAILABILITY_COPY[event.availability]} />
      </div>
    </li>
  );
}

/** A day's releases, or the undated ones, as rows. */
export function ReleaseList({
  events,
  label,
}: {
  events: readonly CalendarEvent[];
  label: string;
}) {
  return (
    <ul className={cx("releases")} aria-label={label}>
      {events.map((event) => (
        <ReleaseRow key={event.id} event={event} />
      ))}
    </ul>
  );
}

/**
 * One release in a square of the month grid: a thumbnail, the title, and a
 * word or two. The link is named in full, with what the square has no room
 * to show: which episode, and whether it can be watched yet.
 */
export function SquareRelease({
  event,
  reachable,
}: {
  event: CalendarEvent;
  /** Whether Tab stops here: only in the day the grid's focus is on. */
  reachable: boolean;
}) {
  const state = AVAILABILITY_COPY[event.availability];
  const opens = useOpensTitle(
    titleAddress(event),
    { path: event.artwork.posterPath, title: releaseTitle(event) },
    `square ${event.id}`,
  );
  return (
    <Link
      className={cx("square")}
      to={titleAddress(event)}
      {...opens.link}
      tabIndex={reachable ? 0 : -1}
    >
      <div className={cx("squarePoster")}>
        <Poster
          path={event.artwork.posterPath}
          title={releaseTitle(event)}
          sizes="26px"
          carries={opens.carries}
        />
      </div>
      <div className={cx("squareText")}>
        <div className={cx("squareTitle")}>{releaseTitle(event)}</div>
        <div className={cx("squareDetail")}>
          {event.availability === "available" && (
            <CheckIcon className={cx("squareReady")} aria-hidden="true" />
          )}
          <span aria-hidden="true">{releaseShortDetail(event)}</span>
          <span className="sr-only">
            {releaseDetail(event)}. {state.label}
          </span>
        </div>
      </div>
    </Link>
  );
}
