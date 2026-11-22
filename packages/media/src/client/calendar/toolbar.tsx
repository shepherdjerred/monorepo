import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";
import { RELEASE_KIND_COPY } from "#client/presentation/calendar.ts";
import { Choice } from "#client/ui/choice.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { DateField } from "#client/ui/date-field.tsx";
import styles from "./calendar.module.css";
import {
  monthLabel,
  monthOf,
  parseDate,
  shiftMonth,
  type CivilDate,
} from "./dates.ts";
import {
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

/**
 * Which month, and what narrows it. Previous, next and Today are links, so
 * each month has an address and Back undoes a step; the filters and the date
 * field refine the view in place.
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
  /** The id the month's name is given, for the grid to be labelled by. */
  headingId: string;
  /** Whether Today leaves the page where it is scrolled: the grid fits. */
  keepsScroll: boolean;
  search: (view: CalendarView) => string;
  onChange: (view: CalendarView, day?: CivilDate) => void;
}) {
  const thisMonth = monthOf(today);
  return (
    <div className={cx("toolbar")}>
      <nav className={cx("monthNav")} aria-label="Month">
        {STEPS.map((step) => {
          const month = shiftMonth(view.month, step.by);
          return (
            <Link
              key={step.word}
              className={cx("step")}
              to={{ search: search({ ...view, month }) }}
              aria-label={`${step.word} month, ${monthLabel(month)}`}
              preventScrollReset
            >
              <step.icon aria-hidden="true" />
            </Link>
          );
        })}
        <h2 className={cx("monthName")} id={headingId} aria-live="polite">
          {monthLabel(view.month)}
        </h2>
        <Link
          className={cx("today")}
          to={{
            search: search({ ...view, month: thisMonth }),
            hash: dayAnchor(today),
          }}
          aria-current={view.month === thisMonth ? "true" : undefined}
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
            onChange({ ...view, kind });
          }}
        />
        <Choice
          label="Ready to watch or not"
          value={view.status}
          values={READINESS}
          labels={READINESS_OPTIONS}
          resting="all"
          onChange={(status) => {
            onChange({ ...view, status });
          }}
        />
        <DateField
          label="Go to"
          name="Go to a date"
          value={marked}
          onChange={(value) => {
            // An emptied or half-typed field names no day.
            const day = parseDate(value);
            if (day !== null) onChange({ ...view, month: monthOf(day) }, day);
          }}
        />
      </div>
    </div>
  );
}
