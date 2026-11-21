import { classNames } from "#client/ui/class-names.ts";
import { SkeletonStatus } from "#client/ui/skeleton.tsx";
import skeletonStyles from "#client/ui/skeleton.module.css";
import styles from "./calendar.module.css";
import {
  dayOfMonth,
  monthOf,
  monthWeeks,
  weekdayNames,
  type CivilMonth,
} from "./dates.ts";
import type { CalendarLayout } from "./view.ts";

const cx = classNames(styles);
const block = classNames(skeletonStyles)("block");

/** Which squares hold a block or two, so the grid reads as a month in use. */
function blocksIn(day: number): number {
  return day % 5 === 0 ? 2 : day % 3 === 0 ? 1 : 0;
}

/**
 * The calendar while its releases load, in the room the answer will take:
 * the month's own grid of days with nothing in them yet, or a few agenda
 * days.
 */
export function CalendarSkeleton({
  month,
  layout,
}: {
  month: CivilMonth;
  layout: CalendarLayout;
}) {
  if (layout === "agenda") {
    return (
      <SkeletonStatus label="Loading the calendar">
        <div className={cx("agenda")}>
          {[2, 1, 3, 1].map((rows, index) => (
            <div className={cx("day")} key={index}>
              <div className={cx("dayHeading")}>
                <div className={`${block} ${cx("skeletonNumeral")}`} />
              </div>
              <div className={cx("releases")}>
                {Array.from({ length: rows }, (_, row) => (
                  <div className={cx("release")} key={row}>
                    <div className={`${block} ${cx("skeletonPoster")}`} />
                    <div className={cx("releaseText")}>
                      <div className={`${block} ${cx("skeletonLine")}`} />
                      <div className={`${block} ${cx("skeletonShortLine")}`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SkeletonStatus>
    );
  }
  return (
    <SkeletonStatus label="Loading the calendar">
      <div className={cx("gridFrame")}>
        <table className={cx("grid")}>
          <thead>
            <tr>
              {weekdayNames().map((name) => (
                <th key={name.long}>{name.short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthWeeks(month).map((week) => (
              <tr key={week[0]}>
                {week.map((date) => (
                  <td
                    className={cx("cell")}
                    key={date}
                    data-outside={monthOf(date) !== month}
                  >
                    <div className={cx("cellDate")}>
                      <span className={cx("cellNumeral")}>
                        {dayOfMonth(date)}
                      </span>
                    </div>
                    <div className={cx("squares")}>
                      {Array.from(
                        { length: blocksIn(dayOfMonth(date)) },
                        (_, row) => (
                          <div
                            className={`${block} ${cx("skeletonSquare")}`}
                            key={row}
                          />
                        ),
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SkeletonStatus>
  );
}
