import type { z } from "zod";
import type { CalendarReleaseKindSchema } from "#shared/household/calendar.ts";

type ReleaseKind = z.infer<typeof CalendarReleaseKindSchema>;

/**
 * What kind of release a calendar date is: the words beside one release,
 * and the words for all of that kind in the filter.
 */
export const RELEASE_KIND_COPY = {
  episode: { label: "New episode", filter: "Episodes" },
  theatrical: { label: "In cinemas", filter: "In cinemas" },
  digital: { label: "Digital release", filter: "Digital releases" },
  physical: { label: "Disc release", filter: "Disc releases" },
} as const satisfies Record<ReleaseKind, { label: string; filter: string }>;
