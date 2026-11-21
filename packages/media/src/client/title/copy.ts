import type { MediaDetail } from "#shared/api.ts";
import type { Availability, MediaItem } from "#shared/contract.ts";
import { AVAILABILITY_COPY } from "#client/presentation/availability.ts";
import type { Copy } from "#client/presentation/copy.ts";
import { shortDate } from "#client/presentation/state-phrase.ts";
import { leavingOf } from "./facts.ts";
import type { MenuAction } from "./primary-action.ts";

/** What kind of thing a title page is about. */
export const TITLE_KIND_COPY = {
  movie: "Film",
  series: "Series",
  season: "Season",
  episode: "Episode",
} as const satisfies Record<MediaItem["kind"], string>;

/** A change to the reader's standing with a title that one command makes. */
export type TitleCommand = Exclude<MenuAction, "request"> | "restore";

/**
 * Each command in the reader's words: the button, what it means, and the
 * confirmation, which uses the button's own verb. `started` is the
 * confirmation of a command the server queued instead of finishing.
 */
export const COMMAND_COPY = {
  hold: {
    label: "Keep for 30 days",
    detail: "Nothing removes it for a month.",
    done: "Kept for 30 days.",
    started: "Kept for 30 days.",
  },
  keep: {
    label: "Keep for good",
    detail: "It stays even when nobody follows it.",
    done: "Kept for good.",
    started: "Kept for good.",
  },
  stop_keeping: {
    label: "Stop keeping for good",
    detail: "It then stays only while someone follows it.",
    done: "Stopped keeping it for good.",
    started: "Stopped keeping it for good.",
  },
  stop_following: {
    label: "Stop following",
    detail: "Ends your request. Nobody else’s changes.",
    done: "Stopped following.",
    started: "Stopped following.",
  },
  restore: {
    label: "Restore",
    detail: "Brings the removed files back.",
    done: "Restored.",
    started: "Restore started. It will be back in the library shortly.",
  },
} as const satisfies Record<
  TitleCommand,
  { label: string; detail: string; done: string; started: string }
>;

/**
 * The one phrase a title page says about its title. A removal the household
 * can still stop comes first; a series or season then says how much of it
 * can be played, and a film or episode where it is on its way in.
 */
export function titleState(
  media: Pick<MediaDetail, "retention" | "visibility" | "availability">,
  availability: Availability = media.availability,
  locale?: string,
): Copy {
  const leaving = leavingOf(media);
  if (leaving?.kind === "leaving") {
    return {
      label:
        leaving.at === null
          ? "Leaving soon"
          : `Leaving ${shortDate(leaving.at, locale)}`,
      tone: "warn",
    };
  }
  const { playback } = media.visibility;
  const gone = availability === "quarantined" || availability === "removed";
  if (gone || playback.scope === "title") {
    return AVAILABILITY_COPY[availability];
  }
  const ready = playback.playableItems + (playback.externalAvailableItems ?? 0);
  if (ready === 0) return AVAILABILITY_COPY[availability];
  if (ready >= playback.visibleItems) return AVAILABILITY_COPY.available;
  return {
    label: `${String(ready)} of ${String(playback.visibleItems)} episodes`,
    tone: "progress",
  };
}

/**
 * How far along the download a member is waiting for is, from 0 to 1, when
 * one is under way and its figure is current.
 */
export function downloadProgress(
  visibility: MediaDetail["visibility"],
): number | null {
  const download = visibility.torrents.find(
    (torrent) =>
      torrent.freshness === "fresh" &&
      torrent.progress !== null &&
      torrent.progress < 1,
  );
  return download?.progress ?? null;
}

/** A day with its year, for a date that may be far off: "Nov 24, 2026". */
export function fullDate(value: string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
