import { z } from "zod";

/**
 * What the History page is narrowed to, as its address says it: a title
 * search, one person (the owner's choice), and a span of days. The same
 * parameters narrow both the statistics and the list of plays.
 *
 * `from` and `to` are moments, as the API takes them: the midnight that
 * starts a day where the reader is. A play happened at a moment, unlike a
 * release date, so here the reader's own clock is the right one.
 *
 * The address is something a person can type, so a value this page cannot
 * read is left out instead of failing the page.
 */
export type HistoryView = {
  search: string;
  /** A household member's id, or null for everyone the reader may see. */
  person: string | null;
  /** Plays that started at or after this moment. */
  from: string | null;
  /** Plays that started before this moment. */
  to: string | null;
};

export const EVERYTHING: HistoryView = {
  search: "",
  person: null,
  from: null,
  to: null,
};

/** The playback API accepts at most 200 characters of search text. */
export const SEARCH_LIMIT = 200;
/** How many plays one answer holds. */
const PAGE_SIZE = 25;

const MomentSchema = z.iso.datetime();
const DaySchema = z.iso.date();

function moment(value: string | null): string | null {
  const parsed = MomentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readHistoryView(params: URLSearchParams): HistoryView {
  const person = params.get("userId");
  return {
    search: (params.get("search") ?? "").slice(0, SEARCH_LIMIT),
    person: person === null || person === "" ? null : person,
    from: moment(params.get("from")),
    to: moment(params.get("to")),
  };
}

/** The filters as the API and the address both spell them. */
function filterParams(view: HistoryView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.search.trim() !== "") params.set("search", view.search.trim());
  if (view.person !== null) params.set("userId", view.person);
  if (view.from !== null) params.set("from", view.from);
  if (view.to !== null) params.set("to", view.to);
  return params;
}

/** The query string of a view, naming only what narrows it. */
export function historySearch(view: HistoryView): string {
  const search = filterParams(view).toString();
  return search === "" ? "" : `?${search}`;
}

/** The filters as one string: what a read's cache entry is keyed by. */
export function filterKey(view: HistoryView): string {
  return filterParams(view).toString();
}

export function isFiltered(view: HistoryView): boolean {
  return filterKey(view) !== "";
}

/** The `GET /api/v1/playback/history` read for one page of a view. */
export function historyReadPath(
  view: HistoryView,
  cursor: string | null,
): string {
  const params = filterParams(view);
  params.set("limit", String(PAGE_SIZE));
  if (cursor !== null) params.set("cursor", cursor);
  return `/playback/history?${params.toString()}`;
}

/** The `GET /api/v1/playback/statistics` read for a view. */
export function statisticsReadPath(view: HistoryView): string {
  const query = filterKey(view);
  return query === ""
    ? "/playback/statistics"
    : `/playback/statistics?${query}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** The day a moment falls on where the reader is, as a date field shows it. */
export function localDay(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return `${String(date.getFullYear())}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

/**
 * The moment a day starts where the reader is, from what a date field
 * holds. Null when the field names no day.
 */
export function dayStart(day: string): string | null {
  const parsed = DaySchema.safeParse(day);
  if (!parsed.success) return null;
  const [year = 0, month = 1, date = 1] = parsed.data.split("-").map(Number);
  return new Date(year, month - 1, date).toISOString();
}
