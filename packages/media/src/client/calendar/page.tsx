import { useId } from "react";
import { CalendarXIcon, SearchXIcon } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { CalendarPageSchema } from "#shared/household/calendar.ts";
import { readApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Segmented } from "#client/ui/segmented.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import { useMediaQuery } from "#client/ui/use-media-query.ts";
import { Agenda } from "./agenda.tsx";
import styles from "./calendar.module.css";
import { localToday, monthLabel, monthOf, type CivilDate } from "./dates.ts";
import { releaseDays, type ReleaseDays } from "./events.ts";
import { MonthGrid } from "./month-grid.tsx";
import { ReleaseList } from "./release.tsx";
import { CalendarSkeleton } from "./skeleton.tsx";
import { CalendarToolbar } from "./toolbar.tsx";
import {
  anchoredDay,
  calendarReadPath,
  calendarSearch,
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
  month: "Month",
} as const satisfies Record<CalendarLayout, string>;

/** A month with nothing to show: what is missing and what to do about it. */
function NothingScheduled({
  view,
  clearedSearch,
}: {
  view: CalendarView;
  /** The address of this month with no filters. */
  clearedSearch: string;
}) {
  const name = monthLabel(view.month);
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
 * and the cinema, digital and disc dates of its films. One month at a time,
 * as an agenda on a phone and a month grid on a wider screen unless the
 * address says which.
 */
export function CalendarPage() {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const monthHeading = useId();
  const wide = useMediaQuery(ROOM_FOR_A_MONTH);

  const today = localToday();
  const view = readCalendarView(params, today);
  const layout = view.layout ?? (wide ? "month" : "agenda");
  const marked = anchoredDay(hash);
  const range = visibleRange(view.month, layout);
  const search = (next: CalendarView) => calendarSearch(next, today);

  // The whole range, however many answers it takes: a calendar with a hole
  // in it is wrong, not merely short.
  const calendar = useCursorList({
    queryKey: ["calendar", range.from, range.to, view.kind, view.status],
    paging: "all",
    read: async (cursor) => {
      const page = await readApi(
        calendarReadPath(view, range, cursor),
        CalendarPageSchema,
      );
      return { items: page.events, nextCursor: page.nextCursor };
    },
  });
  // While another month loads, the previous answer is still held; only the
  // part of it that belongs to the days now on screen is shown.
  const releases = releaseDays(
    calendar.items.filter(
      (event) =>
        event.date === null ||
        (event.date >= range.from && event.date <= range.to),
    ),
  );
  const nothing = releases.days.size === 0 && releases.undated.length === 0;
  const loading = calendar.pending || (calendar.stale && nothing);

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
    if (loading) return <CalendarSkeleton month={view.month} layout={layout} />;
    if (nothing) {
      return (
        <NothingScheduled
          view={view}
          clearedSearch={search({ ...view, kind: "all", status: "all" })}
        />
      );
    }
    return (
      <>
        {layout === "month" ? (
          <MonthGrid
            month={view.month}
            today={today}
            marked={marked}
            releases={releases}
            busy={calendar.stale}
            labelledBy={monthHeading}
            agendaAddress={(date) => ({
              search: search({
                ...view,
                month: monthOf(date),
                layout: "agenda",
              }),
              hash: dayAnchor(date),
            })}
            onLeave={(date) => {
              show({ ...view, month: monthOf(date) });
            }}
          />
        ) : (
          <Agenda
            month={view.month}
            today={today}
            marked={marked}
            releases={releases}
            busy={calendar.stale}
          />
        )}
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
            to: { search: search({ ...view, layout: value }), hash },
            current: layout === value,
          }))}
        />
      </div>
      <CalendarToolbar
        view={view}
        today={today}
        marked={marked}
        headingId={monthHeading}
        keepsScroll={layout === "month"}
        search={search}
        onChange={show}
      />
      {content()}
    </>
  );
}
