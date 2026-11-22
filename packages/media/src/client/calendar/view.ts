import {
  firstDay,
  lastDay,
  monthOf,
  monthWeeks,
  parseDate,
  parseMonth,
  weekEnds,
  type CivilDate,
  type CivilMonth,
} from "./dates.ts";

/**
 * The address names the layout, its month or week, and the two filters.
 * A view can be linked, bookmarked and reloaded, and Back undoes a step.
 *
 * The address is something a person can type, so a value this page does not
 * know reads as that setting's default instead of failing the page.
 */

export const RELEASE_KINDS = [
  "all",
  "episode",
  "theatrical",
  "digital",
  "physical",
] as const;
export const READINESS = ["all", "available", "missing"] as const;
export const LAYOUTS = ["agenda", "week", "month"] as const;

export type CalendarLayout = (typeof LAYOUTS)[number];

export type CalendarView = {
  month: CivilMonth;
  /** The Sunday of the selected week, present in the week layout. */
  week?: CivilDate;
  kind: (typeof RELEASE_KINDS)[number];
  status: (typeof READINESS)[number];
  /** Null when the address does not say: the screen's width decides. */
  layout: CalendarLayout | null;
};

/** The id of a day's heading or square, which a link's fragment names. */
export function dayAnchor(date: CivilDate): string {
  return `day-${date}`;
}

/** The day a link's fragment names, or null. */
export function anchoredDay(hash: string): CivilDate | null {
  return hash.startsWith("#day-") ? parseDate(hash.slice(5)) : null;
}

function oneOf<Value extends string>(
  allowed: readonly Value[],
  value: string | null,
): Value | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

export function readCalendarView(
  params: URLSearchParams,
  today: CivilDate,
): CalendarView {
  const layout = oneOf(LAYOUTS, params.get("view"));
  const month = parseMonth(params.get("month")) ?? monthOf(today);
  const date =
    parseDate(params.get("week")) ??
    (month === monthOf(today) ? today : firstDay(month));
  const week = layout === "week" ? weekEnds(date).start : undefined;
  return {
    month: week === undefined ? month : monthOf(week),
    kind: oneOf(RELEASE_KINDS, params.get("kind")) ?? "all",
    status: oneOf(READINESS, params.get("status")) ?? "all",
    layout,
    ...(week === undefined ? {} : { week }),
  };
}

/** Keep the layout and filters while opening the period containing a day. */
export function calendarViewOnDay(
  view: CalendarView,
  day: CivilDate,
): CalendarView {
  if (view.layout !== "week") return { ...view, month: monthOf(day) };
  const week = weekEnds(day).start;
  return { ...view, month: monthOf(week), week };
}

/**
 * Leave out the current month or week so links to the current period advance
 * with the viewer's calendar.
 */
export function calendarSearch(view: CalendarView, today: CivilDate): string {
  const params = new URLSearchParams();
  if (view.layout !== "week" && view.month !== monthOf(today)) {
    params.set("month", view.month);
  }
  if (view.kind !== "all") params.set("kind", view.kind);
  if (view.status !== "all") params.set("status", view.status);
  if (view.layout !== null) params.set("view", view.layout);
  if (
    view.layout === "week" &&
    view.week !== undefined &&
    view.week !== weekEnds(today).start
  ) {
    params.set("week", view.week);
  }
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function isFiltered(view: CalendarView): boolean {
  return view.kind !== "all" || view.status !== "all";
}

/**
 * The agenda shows its month, Week shows seven days, and the month grid
 * includes the neighbouring dates in its first and last rows.
 */
export function visibleRange(
  month: CivilMonth,
  layout: CalendarLayout,
  week?: CivilDate,
): { from: CivilDate; to: CivilDate } {
  if (layout === "agenda") return { from: firstDay(month), to: lastDay(month) };
  if (layout === "week") {
    const { start, end } = weekEnds(week ?? firstDay(month));
    return { from: start, to: end };
  }
  const weeks = monthWeeks(month);
  const from = weeks[0]?.[0];
  const to = weeks.at(-1)?.[6];
  if (from === undefined || to === undefined) {
    throw new Error(`The month ${month} has no weeks`);
  }
  return { from, to };
}

/** The most releases the API returns in one answer. */
const PAGE_SIZE = 100;

/** The `GET /api/v1/calendar` read for one page of a range. */
export function calendarReadPath(
  view: Pick<CalendarView, "kind" | "status">,
  range: { from: CivilDate; to: CivilDate },
  cursor: string | null,
): string {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    kind: view.kind,
    status: view.status,
    limit: String(PAGE_SIZE),
  });
  if (cursor !== null) params.set("cursor", cursor);
  return `/calendar?${params.toString()}`;
}
