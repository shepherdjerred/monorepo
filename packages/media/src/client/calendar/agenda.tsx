import { classNames } from "#client/ui/class-names.ts";
import styles from "./calendar.module.css";
import {
  dayLabel,
  dayOfMonth,
  monthDays,
  monthLabel,
  weekDays,
  weekdayShort,
  type CivilDate,
  type CivilMonth,
} from "./dates.ts";
import type { ReleaseDays } from "./events.ts";
import { ReleaseList } from "./release.tsx";
import { dayAnchor } from "./view.ts";

const cx = classNames(styles);

/**
 * A month lists its releases and today. A week lists all seven days so
 * the reader can see the full span on a phone even when it is quiet.
 */
export function Agenda({
  month,
  week,
  today,
  marked,
  releases,
  busy,
}: {
  month: CivilMonth;
  week: CivilDate | undefined;
  today: CivilDate;
  /** The day a link or the date field asked for. */
  marked: CivilDate | null;
  releases: ReleaseDays;
  busy: boolean;
}) {
  const days =
    week === undefined
      ? monthDays(month).filter(
          (date) => releases.days.has(date) || date === today,
        )
      : weekDays(week);
  if (days.length === 0) {
    return (
      <p className={cx("quietMonth")}>
        No releases are dated in {monthLabel(month)}.
      </p>
    );
  }
  return (
    <div className={cx("agenda")} aria-busy={busy}>
      {days.map((date) => {
        const events = releases.days.get(date) ?? [];
        const label = dayLabel(date);
        return (
          <section
            className={cx("day")}
            key={date}
            aria-labelledby={dayAnchor(date)}
            data-today={date === today}
            data-marked={date === marked}
          >
            <h3 className={cx("dayHeading")} id={dayAnchor(date)}>
              <span className={cx("dayNumeral")} aria-hidden="true">
                {dayOfMonth(date)}
              </span>
              <span className={cx("dayWeekday")} aria-hidden="true">
                {weekdayShort(date)}
              </span>
              <span className="sr-only">{label}</span>
              {date === today && <span className={cx("todayTag")}>Today</span>}
            </h3>
            {events.length === 0 ? (
              <p className={cx("quietDay")}>
                {week === undefined ? "Nothing is out today." : "No releases."}
              </p>
            ) : (
              <ReleaseList events={events} label={`Releases on ${label}`} />
            )}
          </section>
        );
      })}
    </div>
  );
}
