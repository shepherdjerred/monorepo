import {
  firstDay,
  lastDay,
  monthOf,
  monthWeeks,
  parseDate,
  parseMonth,
  type CivilDate,
  type CivilMonth,
} from "./dates.ts";

/**
 * What the calendar shows, as its address says it: the month, the two
 * filters, and whether it is laid out as an agenda or a month grid. A view
 * can be linked, bookmarked and reloaded, and Back undoes a step.
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
export const LAYOUTS = ["agenda", "month"] as const;

export type CalendarLayout = (typeof LAYOUTS)[number];

export type CalendarView = {
  month: CivilMonth;
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
  return {
    month: parseMonth(params.get("month")) ?? monthOf(today),
    kind: oneOf(RELEASE_KINDS, params.get("kind")) ?? "all",
    status: oneOf(READINESS, params.get("status")) ?? "all",
    layout: oneOf(LAYOUTS, params.get("view")),
  };
}

/**
 * The query string of a view. The month the viewer is in is left out, so a
 * bookmark of "this month" is still this month next month.
 */
export function calendarSearch(view: CalendarView, today: CivilDate): string {
  const params = new URLSearchParams();
  if (view.month !== monthOf(today)) params.set("month", view.month);
  if (view.kind !== "all") params.set("kind", view.kind);
  if (view.status !== "all") params.set("status", view.status);
  if (view.layout !== null) params.set("view", view.layout);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function isFiltered(view: CalendarView): boolean {
  return view.kind !== "all" || view.status !== "all";
}

/**
 * The days a layout shows: the month itself as an agenda, and as a grid the
 * whole weeks around it, whose first and last rows reach into the
 * neighbouring months.
 */
export function visibleRange(
  month: CivilMonth,
  layout: CalendarLayout,
): { from: CivilDate; to: CivilDate } {
  if (layout === "agenda") return { from: firstDay(month), to: lastDay(month) };
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
