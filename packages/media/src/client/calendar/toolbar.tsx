import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";
import { RELEASE_KIND_COPY } from "#client/presentation/calendar.ts";
import { Choice } from "#client/ui/choice.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { DateField } from "#client/ui/date-field.tsx";
import styles from "./calendar.module.css";
import {
  monthLabel,
  parseDate,
  shiftDays,
  shiftMonth,
  weekLabel,
  type CivilDate,
} from "./dates.ts";
import {
  calendarViewOnDay,
  dayAnchor,
  READINESS,
  RELEASE_KINDS,
  type CalendarView,
} from "./view.ts";

const cx = classNames(styles);

const KIND_OPTIONS = {
  all: "All releases",
  episode: RELEASE_KIND_COPY.episode.filter,
  theatrical: RELEASE_KIND_COPY.theatrical.filter,
  digital: RELEASE_KIND_COPY.digital.filter,
  physical: RELEASE_KIND_COPY.physical.filter,
} as const satisfies Record<CalendarView["kind"], string>;
const READINESS_OPTIONS = {
  all: "Ready or not",
  available: "Ready to watch",
  missing: "Not ready yet",
} as const satisfies Record<CalendarView["status"], string>;

const STEPS = [
  { by: -1, word: "Previous", icon: ChevronLeftIcon },
  { by: 1, word: "Next", icon: ChevronRightIcon },
] as const;

function periodLabel(view: CalendarView): string {
  return view.week === undefined
    ? monthLabel(view.month)
    : weekLabel(view.week);
}

/**
 * Previous, Next and Today link to calendar periods so Back undoes a step.
 * The filters and date field refine the view in place.
 */
export function CalendarToolbar({
  view,
  today,
  marked,
  headingId,
  keepsScroll,
  search,
  onChange,
}: {
  view: CalendarView;
  today: CivilDate;
  /** The day the address marks, which the date field shows. */
  marked: CivilDate | null;
  /** The heading that names the displayed period and its grid. */
  headingId: string;
  /** Whether Today leaves the page where it is scrolled: the grid fits. */
  keepsScroll: boolean;
  search: (view: CalendarView) => string;
  onChange: (view: CalendarView, day?: CivilDate) => void;
}) {
  const week = view.week;
  const period = week === undefined ? "month" : "week";
  const current = calendarViewOnDay(view, today);
  const showingCurrent =
    week === undefined ? view.month === current.month : week === current.week;
  return (
    <div className={cx("toolbar")}>
      <nav
        className={cx("monthNav")}
        aria-label={week === undefined ? "Month" : "Week"}
        data-period={period}
      >
        {STEPS.map((step) => {
          const next =
            week === undefined
              ? { ...view, month: shiftMonth(view.month, step.by) }
              : calendarViewOnDay(view, shiftDays(week, step.by * 7));
          return (
            <Link
              key={step.word}
              className={cx("step")}
              to={{ search: search(next) }}
              aria-label={`${step.word} ${period}, ${periodLabel(next)}`}
              preventScrollReset
            >
              <step.icon aria-hidden="true" />
            </Link>
          );
        })}
        <h2 className={cx("monthName")} id={headingId} aria-live="polite">
          {periodLabel(view)}
        </h2>
        <Link
          className={cx("today")}
          to={{
            search: search(current),
            hash: dayAnchor(today),
          }}
          aria-current={showingCurrent ? "true" : undefined}
          preventScrollReset={keepsScroll}
        >
          Today
        </Link>
      </nav>
      <div className={cx("filters")} role="group" aria-label="Filters">
        <Choice
          label="Kind of release"
          value={view.kind}
          values={RELEASE_KINDS}
          labels={KIND_OPTIONS}
          resting="all"
          onChange={(kind) => {
            onChange(
              { ...view, kind },
              week === undefined ? undefined : (marked ?? undefined),
            );
          }}
        />
        <Choice
          label="Ready to watch or not"
          value={view.status}
          values={READINESS}
          labels={READINESS_OPTIONS}
          resting="all"
          onChange={(status) => {
            onChange(
              { ...view, status },
              week === undefined ? undefined : (marked ?? undefined),
            );
          }}
        />
        <DateField
          label="Go to"
          name="Go to a date"
          value={marked}
          onChange={(value) => {
            // An emptied or half-typed field names no day.
            const day = parseDate(value);
            if (day !== null) onChange(calendarViewOnDay(view, day), day);
          }}
        />
      </div>
    </div>
  );
}
