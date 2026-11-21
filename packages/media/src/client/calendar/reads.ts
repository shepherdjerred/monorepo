import {
  CalendarPageSchema,
  type CalendarEvent,
} from "#shared/household/calendar.ts";
import { readApi } from "#client/api.ts";
import type { CursorPage } from "#client/ui/use-cursor-list.ts";
import type { CivilDate } from "./dates.ts";
import { calendarReadPath, type CalendarView } from "./view.ts";

/**
 * The releases of a range of days, with the cache key they are kept under.
 * The whole range, however many answers it takes: a calendar with a hole in
 * it is wrong, not merely short.
 *
 * Home's week reads through this too, so the two pages keep one answer per
 * range and a refresh of the calendar reaches both.
 */
export function calendarRead(
  filters: Pick<CalendarView, "kind" | "status">,
  range: { from: CivilDate; to: CivilDate },
) {
  return {
    queryKey: ["calendar", range.from, range.to, filters.kind, filters.status],
    paging: "all",
    read: async (cursor: string | null): Promise<CursorPage<CalendarEvent>> => {
      const page = await readApi(
        calendarReadPath(filters, range, cursor),
        CalendarPageSchema,
      );
      return { items: page.events, nextCursor: page.nextCursor };
    },
  } as const;
}
