import { classNames } from "#client/ui/class-names.ts";
import { SkeletonStatus } from "#client/ui/skeleton.tsx";
import skeletonStyles from "#client/ui/skeleton.module.css";
import styles from "./calendar.module.css";
import {
  dayOfMonth,
  monthOf,
  monthWeeks,
  weekDays,
  weekdayNames,
  type CivilDate,
  type CivilMonth,
} from "./dates.ts";

const cx = classNames(styles);
const block = classNames(skeletonStyles)("block");

/** Which squares hold a block or two, so the grid reads as a month in use. */
function blocksIn(day: number): number {
  return day % 5 === 0 ? 2 : day % 3 === 0 ? 1 : 0;
}

/**
 * The calendar while its releases load, in the room the answer will take:
 * a grid of dates with nothing in them yet, or a few agenda days.
 */
export function CalendarSkeleton({
  month,
  week,
  grid,
}: {
  month: CivilMonth;
  week: CivilDate | undefined;
  grid: boolean;
}) {
  if (!grid) {
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
            {(week === undefined ? monthWeeks(month) : [weekDays(week)]).map(
              (days) => (
                <tr key={days[0]}>
                  {days.map((date) => (
                    <td
                      className={cx("cell")}
                      key={date}
                      data-outside={
                        week === undefined && monthOf(date) !== month
                      }
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
              ),
            )}
          </tbody>
        </table>
      </div>
    </SkeletonStatus>
  );
}
