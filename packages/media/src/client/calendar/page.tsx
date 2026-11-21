import { useId } from "react";
import { CalendarXIcon, SearchXIcon } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { PageTitle } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Segmented } from "#client/ui/segmented.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import { useMediaQuery } from "#client/ui/use-media-query.ts";
import { Agenda } from "./agenda.tsx";
import styles from "./calendar.module.css";
import {
  firstDay,
  localToday,
  monthLabel,
  monthOf,
  weekLabel,
  type CivilDate,
} from "./dates.ts";
import { releaseDays, type ReleaseDays } from "./events.ts";
import { MonthGrid } from "./month-grid.tsx";
import { calendarRead } from "./reads.ts";
import { ReleaseList } from "./release.tsx";
import { CalendarSkeleton } from "./skeleton.tsx";
import { CalendarToolbar } from "./toolbar.tsx";
import {
  anchoredDay,
  calendarSearch,
  calendarViewOnDay,
  dayAnchor,
  isFiltered,
  LAYOUTS,
  readCalendarView,
  visibleRange,
  type CalendarLayout,
  type CalendarView,
} from "./view.ts";

const cx = classNames(styles);

/** Wide enough for a month of squares with words in them. */
const ROOM_FOR_A_MONTH = "(min-width: 761px)";

const LAYOUT_NAMES = {
  agenda: "Agenda",
  week: "Week",
  month: "Month",
} as const satisfies Record<CalendarLayout, string>;

/** A period with no releases: what is missing and what to do about it. */
function NothingScheduled({
  view,
  clearedSearch,
}: {
  view: CalendarView;
  /** The address of this period with no filters. */
  clearedSearch: string;
}) {
  const name =
    view.week === undefined
      ? monthLabel(view.month)
      : `the week of ${weekLabel(view.week)}`;
  if (isFiltered(view)) {
    return (
      <EmptyState
        icon={SearchXIcon}
        title="No releases match"
        action={
          <Link
            className="button"
            to={{ search: clearedSearch }}
            replace
            preventScrollReset
          >
            Clear filters
          </Link>
        }
      >
        Nothing in {name} fits these filters.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={CalendarXIcon}
      title={`Nothing on the calendar for ${name}`}
      action={
        <Link className="button primary" to="/discover">
          Find something to watch
        </Link>
      }
    >
      Episodes of series you follow and the release dates of films you asked for
      appear here.
    </EmptyState>
  );
}

/** Releases that have no date yet, apart from every day. */
function Undated({ releases }: { releases: ReleaseDays }) {
  const heading = useId();
  if (releases.undated.length === 0) return null;
  return (
    <section className={cx("undated")} aria-labelledby={heading}>
      <h2 id={heading}>Date not announced</h2>
      <p className={cx("undatedNote")}>
        These have no release date yet. Each moves onto the calendar when its
        date is announced.
      </p>
      <ReleaseList
        events={releases.undated}
        label="Releases with no date yet"
      />
    </section>
  );
}

/**
 * The household's calendar: the episodes of series it follows as they air,
 * and the cinema, digital and disc dates of its films. The address selects
 * a week, a month grid or an agenda. The default layout follows the screen.
 */
export function CalendarPage() {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const periodHeading = useId();
  const wide = useMediaQuery(ROOM_FOR_A_MONTH);

  const today = localToday();
  const view = readCalendarView(params, today);
  const layout = view.layout ?? (wide ? "month" : "agenda");
  const marked = anchoredDay(hash);
  const grid = layout === "month" || (layout === "week" && wide);
  const range = visibleRange(view.month, layout, view.week);
  const search = (next: CalendarView) => calendarSearch(next, today);
  const inRange = (date: CivilDate) => date >= range.from && date <= range.to;

  function layoutSearch(nextLayout: CalendarLayout) {
    const next = { ...view, layout: nextLayout };
    if (nextLayout === layout || (layout !== "week" && nextLayout !== "week")) {
      return search(next);
    }
    const currentDay =
      view.week === undefined
        ? view.month === monthOf(today)
          ? today
          : firstDay(view.month)
        : inRange(today)
          ? today
          : view.week;
    const day = marked !== null && inRange(marked) ? marked : currentDay;
    return search(calendarViewOnDay(next, day));
  }

  const calendar = useCursorList(calendarRead(view, range));
  // While another period loads, the previous answer is still held; only the
  // part of it that belongs to the days now on screen is shown.
  const releases = releaseDays(
    calendar.items.filter(
      (event) => event.date === null || inRange(event.date),
    ),
  );
  const nothing = releases.days.size === 0 && releases.undated.length === 0;
  const loading =
    calendar.pending || (layout !== "week" && calendar.stale && nothing);

  function show(next: CalendarView, day: CivilDate | null = null) {
    void navigate(
      { search: search(next), hash: day === null ? "" : dayAnchor(day) },
      { replace: true, preventScrollReset: true },
    );
  }

  function content() {
    if (calendar.error !== null) {
      return (
        <ErrorState
          error={calendar.error}
          what="The calendar"
          onRetry={calendar.retry}
        />
      );
    }
    if (loading) {
      return (
        <CalendarSkeleton month={view.month} week={view.week} grid={grid} />
      );
    }
    const empty =
      nothing && !calendar.stale ? (
        <NothingScheduled
          view={view}
          clearedSearch={search({ ...view, kind: "all", status: "all" })}
        />
      ) : null;
    if (nothing && layout !== "week") return empty;
    return (
      <>
        {grid ? (
          <MonthGrid
            month={view.month}
            week={view.week}
            today={today}
            marked={marked}
            releases={releases}
            busy={calendar.stale}
            labelledBy={periodHeading}
            agendaAddress={(date) => ({
              search: search({
                ...view,
                month: monthOf(date),
                layout: "agenda",
              }),
              hash: dayAnchor(date),
            })}
            onLeave={(date) => {
              show(calendarViewOnDay(view, date));
            }}
          />
        ) : (
          <Agenda
            month={view.month}
            week={view.week}
            today={today}
            marked={marked}
            releases={releases}
            busy={calendar.stale}
          />
        )}
        {empty}
        <Undated releases={releases} />
      </>
    );
  }

  return (
    <>
      <div className={cx("header")}>
        <PageTitle title="Calendar">
          <p>
            New episodes of the series your household follows, and when its
            films reach cinemas, streaming and disc in the United States. Dates
            can change.
          </p>
        </PageTitle>
        <Segmented
          label="Calendar layout"
          marks="true"
          segments={LAYOUTS.map((value) => ({
            label: LAYOUT_NAMES[value],
            to: { search: layoutSearch(value), hash },
            current: layout === value,
          }))}
        />
      </div>
      <CalendarToolbar
        view={view}
        today={today}
        marked={marked}
        headingId={periodHeading}
        keepsScroll={grid}
        search={search}
        onChange={show}
      />
      {content()}
    </>
  );
}
