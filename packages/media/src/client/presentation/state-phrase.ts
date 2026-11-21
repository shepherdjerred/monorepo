import type { z } from "zod";
import type { LibraryPageSchema } from "#shared/household/library.ts";
import { AVAILABILITY_COPY } from "./availability.ts";
import type { Copy } from "./copy.ts";

type LibraryItem = z.infer<typeof LibraryPageSchema>["items"][number];
type LeavingSoon = NonNullable<LibraryItem["leavingSoon"]>;

/** A day as a card has room for it: "Nov 24". */
export function shortDate(value: string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

/** When a title goes, once it has a date; before that, only that it will. */
export const LEAVING_COPY = {
  warning_pending: () => "Leaving soon",
  grace_period: (graceUntil: string | null, locale?: string) =>
    graceUntil === null
      ? "Leaving soon"
      : `Leaving ${shortDate(graceUntil, locale)}`,
} as const satisfies Record<
  LeavingSoon["state"],
  (graceUntil: string | null, locale?: string) => string
>;

export const KIND_COPY = {
  movie: "Film",
  series: "Series",
} as const satisfies Record<LibraryItem["kind"], string>;

/** "Film, 2024" or "Series", as the line under a title. */
export function kindAndYear(
  kind: LibraryItem["kind"],
  year: number | null,
): string {
  const label = KIND_COPY[kind];
  return year === null ? label : `${label}, ${String(year)}`;
}

function episodesPhrase(episodes: NonNullable<LibraryItem["episodes"]>): Copy {
  if (episodes.available === 0) {
    return { label: "No episodes yet", tone: "neutral" };
  }
  if (episodes.available >= episodes.total) {
    return AVAILABILITY_COPY.available;
  }
  return {
    label: `${String(episodes.available)} of ${String(episodes.total)} episodes`,
    tone: "progress",
  };
}

/**
 * The one thing a card says about a title. A removal the household can still
 * stop comes first, because it is the only state that asks for something;
 * otherwise a series reports how much of it can be played and a film where
 * it is on its way in.
 */
export function libraryStatePhrase(
  item: Pick<LibraryItem, "availability" | "episodes" | "leavingSoon">,
  locale?: string,
): Copy {
  if (item.leavingSoon !== null) {
    return {
      label: LEAVING_COPY[item.leavingSoon.state](
        item.leavingSoon.graceUntil,
        locale,
      ),
      tone: "warn",
    };
  }
  if (item.episodes !== null) return episodesPhrase(item.episodes);
  // A series the API gives no count for is one a Plex library outside Media
  // already holds, so it can be played.
  return AVAILABILITY_COPY[item.availability ?? "available"];
}
