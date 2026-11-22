import type { MediaDetail } from "#shared/api.ts";
import type { Availability, MediaItem } from "#shared/contract.ts";
import {
  INTEREST_ACTION_NAMES,
  LIBRARY_KEEPING_NAMES,
  LIBRARY_VIEW_NAMES,
} from "#shared/household/names.ts";
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
 * The commands about the household's standing with a title: how long the
 * library keeps it, and the reader's own interest in it. They are the same
 * for a film and a series.
 */
export type HouseholdCommand = Extract<
  TitleCommand,
  "keep_for_good" | "keep_for_now" | "stop_following"
>;

/** The commands against a title's own target: its holds, request and files. */
export type TargetCommand = Exclude<TitleCommand, HouseholdCommand>;

/**
 * The command when it is one against the title's own target, which a row of
 * a list can send; null for one of the household's.
 */
export function targetCommand(command: TitleCommand): TargetCommand | null {
  switch (command) {
    case "keep_for_good":
    case "keep_for_now":
    case "stop_following": {
      return null;
    }
    case "hold":
    case "pin":
    case "unpin":
    case "cancel_request":
    case "restore": {
      return command;
    }
  }
}

/**
 * Each command in the reader's words: the button, what it means, and the
 * confirmation, which uses the button's own verb. `started` is the
 * confirmation of a command the server queued instead of finishing.
 *
 * Three of them keep a title, and each line says how it differs. Keeping is
 * the library's standing choice (the owner's switch, named as the Library
 * names it). A 30-day hold and a pin protect the title on top of that choice
 * and leave it as it was.
 */
export const COMMAND_COPY = {
  keep_for_good: {
    label: LIBRARY_KEEPING_NAMES.keep,
    detail: "The library keeps it whether or not anyone follows it.",
    done: "Kept for good.",
    started: "Kept for good.",
  },
  keep_for_now: {
    label: LIBRARY_KEEPING_NAMES.temporary,
    detail: "The library keeps it while someone follows it, then lets it go.",
    done: "Kept just for now.",
    started: "Kept just for now.",
  },
  hold: {
    label: "Keep for 30 days",
    detail:
      "Nothing removes it for a month. How long the library keeps it stays as it is.",
    done: "Kept for 30 days.",
    started: "Kept for 30 days.",
  },
  // The owner's own hold with no end. It is not the library's keeping
  // switch ("Keep for good"), so it is never called that.
  pin: {
    label: "Pin so it never leaves",
    detail:
      "Your own lock: nothing removes it until you take the pin off, however long the library keeps it.",
    done: "Pinned.",
    started: "Pinned.",
  },
  unpin: {
    label: "Remove pin",
    detail: "After that, how long the library keeps it decides when it leaves.",
    done: "Pin removed.",
    started: "Pin removed.",
  },
  // Letting an interest go. The request stays on record, under Mine in the
  // Library, where "Keep watching" picks it up again.
  stop_following: {
    label: INTEREST_ACTION_NAMES.drop,
    detail: `You are done with it. Your request stays under ${LIBRARY_VIEW_NAMES.mine} in the Library, where you can pick it up again.`,
    done: "You no longer follow this.",
    started: "You no longer follow this.",
  },
  // Withdrawing the request itself. It is offered where there is no interest
  // of the reader's own to let go: see `primary-action.ts`.
  cancel_request: {
    label: "Cancel request",
    detail:
      "Withdraws your request for this title. Nobody else’s request changes.",
    done: "Request cancelled.",
    started: "Request cancelled.",
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
