import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { Link, type To } from "react-router";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./calendar.module.css";
import {
  dayLabel,
  dayOfMonth,
  firstDay,
  monthOf,
  monthShort,
  monthWeeks,
  weekDays,
  weekEnds,
  weekdayNames,
  type CivilDate,
  type CivilMonth,
} from "./dates.ts";
import { releaseCount, squareReleases, type ReleaseDays } from "./events.ts";
import { keyDestination } from "./grid-keys.ts";
import { SquareRelease } from "./release.tsx";
import { dayAnchor } from "./view.ts";

const cx = classNames(styles);

/**
 * A wall calendar for a month or a single week, with a cell for each day.
 *
 * It is an ARIA grid with one Tab stop. The arrow keys move between days,
 * Home and End go to the ends of the week, and Page Up and Page Down go a
 * period back or on. Moving past the displayed period opens the next one.
 * From the focused day, Tab visits its releases and then leaves the grid.
 *
 * On a screen too narrow for words in a square, each day shows how many
 * releases it has, as a link to that day in the agenda.
 */
export function MonthGrid({
  month,
  week,
  today,
  marked,
  releases,
  busy,
  labelledBy,
  agendaAddress,
  onLeave,
}: {
  month: CivilMonth;
  week: CivilDate | undefined;
  today: CivilDate;
  /** The day a link or the date field asked for. */
  marked: CivilDate | null;
  releases: ReleaseDays;
  busy: boolean;
  /** The id of the heading that names the displayed period. */
  labelledBy: string;
  /** Where a day's full list is: that day in the agenda. */
  agendaAddress: (date: CivilDate) => To;
  /** Opens the period a day outside this one belongs to. */
  onLeave: (date: CivilDate) => void;
}) {
  const weeks = week === undefined ? monthWeeks(month) : [weekDays(week)];
  const names = weekdayNames();
  const weekRange = week === undefined ? undefined : weekEnds(week);

  function inPeriod(date: CivilDate): boolean {
    return weekRange === undefined
      ? monthOf(date) === month
      : date >= weekRange.start && date <= weekRange.end;
  }

  // The day the grid's one Tab stop is on: the day the reader last moved
  // to, else the day a link asked for, else today, else the 1st.
  const [chosen, setChosen] = useState<CivilDate | null>(null);
  const resting =
    marked !== null && inPeriod(marked)
      ? marked
      : inPeriod(today)
        ? today
        : (week ?? firstDay(month));
  const active = chosen !== null && inPeriod(chosen) ? chosen : resting;

  // A key press asks for focus on a day. Its square takes it once it is the
  // active one, which for a day in another month is after that month opens.
  const awaited = useRef<CivilDate | null>(null);
  const takeFocus = useCallback(
    (square: HTMLTableCellElement | null) => {
      if (square === null || awaited.current !== active) return;
      awaited.current = null;
      square.focus();
    },
    [active],
  );

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    // Only from a day itself: a link inside one keeps its own keys.
    const from = event.target;
    if (!(from instanceof HTMLTableCellElement)) return;
    const date = from.dataset["date"];
    if (date === undefined) return;
    const destination = keyDestination(
      event.key,
      date,
      week === undefined ? "month" : "week",
    );
    if (destination === null) return;
    event.preventDefault();
    awaited.current = destination;
    setChosen(destination);
    if (!inPeriod(destination)) onLeave(destination);
  }

  return (
    <div className={cx("gridFrame")}>
      <table
        className={cx("grid")}
        role="grid"
        aria-labelledby={labelledBy}
        aria-busy={busy}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {names.map((name) => (
              <th key={name.long} scope="col" abbr={name.long}>
                <span aria-hidden="true">{name.short}</span>
                <span className="sr-only">{name.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((days) => (
            <tr key={days[0]}>
              {days.map((date) => {
                const events = releases.days.get(date) ?? [];
                const { listed, more } = squareReleases(events);
                const outside = !inPeriod(date);
                const label = dayLabel(date);
                const reachable = date === active;
                return (
                  <td
                    key={date}
                    id={dayAnchor(date)}
                    role="gridcell"
                    className={cx("cell")}
                    data-date={date}
                    data-outside={outside}
                    data-today={date === today}
                    data-marked={date === marked}
                    aria-current={date === today ? "date" : undefined}
                    aria-label={`${label}${date === today ? ", today" : ""}, ${
                      events.length === 0
                        ? "no releases"
                        : releaseCount(events.length)
                    }`}
                    tabIndex={reachable ? 0 : -1}
                    ref={reachable ? takeFocus : undefined}
                    onFocus={() => {
                      setChosen(date);
                    }}
                  >
                    <time className={cx("cellDate")} dateTime={date}>
                      {(outside || week !== undefined) &&
                        dayOfMonth(date) === 1 && (
                          <span className={cx("cellMonth")}>
                            {monthShort(date)}{" "}
                          </span>
                        )}
                      <span className={cx("cellNumeral")}>
                        {dayOfMonth(date)}
                      </span>
                    </time>
                    {events.length > 0 && (
                      <>
                        <ul className={cx("squares")}>
                          {listed.map((event) => (
                            <li key={event.id}>
                              <SquareRelease
                                event={event}
                                reachable={reachable}
                              />
                            </li>
                          ))}
                        </ul>
                        {more > 0 && (
                          <Link
                            className={cx("more")}
                            to={agendaAddress(date)}
                            tabIndex={reachable ? 0 : -1}
                          >
                            {String(more)} more
                            <span className="sr-only"> on {label}</span>
                          </Link>
                        )}
                        <Link
                          className={cx("tally")}
                          to={agendaAddress(date)}
                          tabIndex={reachable ? 0 : -1}
                          aria-label={`${releaseCount(events.length)} on ${label}`}
                        >
                          {events.length}
                        </Link>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
