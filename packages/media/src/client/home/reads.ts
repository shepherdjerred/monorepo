import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type { LibraryPageSchema } from "#shared/household/library.ts";
import { NowPlayingSchema } from "#shared/household/playback.ts";
import { RecoveryListSchema } from "#shared/recovery.ts";
import { readApi } from "#client/api.ts";
import { localToday } from "#client/calendar/dates.ts";
import { calendarRead } from "#client/calendar/reads.ts";
import {
  interestsRead,
  libraryRead,
  REMOVALS_READ,
  REQUESTS_READ,
} from "#client/library/reads.ts";
import { leavingTitles, type LeavingTitle } from "#client/library/removals.ts";
import { DEFAULT_VIEW, type LibraryView } from "#client/library/view.ts";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import {
  interestChecks,
  onTheWay,
  ownerDecisions,
  thisWeek,
  weekFrom,
  type InterestCheck,
  type OnTheWayTitle,
  type OwnerDecision,
  type WeekDay,
} from "./model.ts";

/** Where one of Home's reads stands, as the section that shows it sees it. */
export type ReadState = {
  /** Nothing to show yet: the first answer has not arrived. */
  pending: boolean;
  /** The read failed, and no earlier answer is left to show in its place. */
  error: Error | null;
  retry: () => void;
};

export type Read<Item> = ReadState & { items: readonly Item[] };

export type PlaybackSession = z.infer<typeof NowPlayingSchema>["items"][number];
export type LibraryItem = z.infer<typeof LibraryPageSchema>["items"][number];

/** The Library sorted by what arrived last, which "See all" opens. */
export const ADDED_VIEW: LibraryView = { ...DEFAULT_VIEW, sort: "added" };

/** How often Home asks again for what changes while it is open. */
const REFRESH = 60_000;

/** A rail's worth of what is new; "See all" has the rest. */
const ADDED_SHOWN = 20;

/** What Plex says is playing; nothing while Media cannot see Plex. */
function playingNow(now: z.infer<typeof NowPlayingSchema>): PlaybackSession[] {
  return now.stale ? [] : now.items;
}

/**
 * Every read Home is made of. Each is its own query, so each section loads
 * and fails on its own; none waits for another.
 *
 * Requests, interests, the library sorted by arrival, and removals are read
 * under the Library's own keys (`library/reads.ts`), the week's releases
 * through the Calendar's read (`calendar/reads.ts`), and what is playing
 * under History's key, so an answer another page already has is not asked
 * for again. Nothing here refreshes more often than the page it is shared
 * with.
 */
export function useHomeReads(user: MediaUser) {
  const owner = user.role === "owner";
  const today = localToday();

  const requests = useQuery({ ...REQUESTS_READ, refetchInterval: REFRESH });
  const interests = useCursorList(interestsRead(user.id));
  const recovery = useQuery({
    queryKey: ["recovery"],
    queryFn: () => readApi("/recovery", RecoveryListSchema),
    // What a recovery review waits on is the owner's to decide.
    enabled: owner,
    select: ownerDecisions,
  });
  const playing = useQuery({
    queryKey: ["playback", "now"],
    queryFn: () => readApi("/playback/now-playing", NowPlayingSchema),
    refetchInterval: REFRESH,
    select: playingNow,
  });
  const added = useCursorList(libraryRead(ADDED_VIEW));
  // The Calendar's own read, for the week instead of a month.
  const calendar = useCursorList(
    calendarRead({ kind: "all", status: "all" }, weekFrom(today)),
  );
  const removals = useQuery({ ...REMOVALS_READ, select: leavingTitles });

  const checks = interestChecks(interests.items, requests.data ?? [], user.id);
  const decisions: readonly OwnerDecision[] = owner
    ? (recovery.data ?? [])
    : [];
  const interestsError = interests.items.length === 0 ? interests.error : null;
  const recoveryError =
    owner && recovery.data === undefined ? recovery.error : null;
  const leaving: readonly LeavingTitle[] = removals.data ?? [];

  return {
    needs: {
      checks,
      decisions,
      pending:
        checks.length + decisions.length === 0 &&
        (interests.pending || (owner && recovery.isPending)),
      error: interestsError ?? recoveryError,
      retry: () => {
        interests.retry();
        if (owner) void recovery.refetch();
      },
    } satisfies ReadState & {
      checks: readonly InterestCheck[];
      decisions: readonly OwnerDecision[];
    },
    playing: {
      items: playing.data ?? [],
      pending: playing.isPending,
      error: playing.data === undefined ? playing.error : null,
      retry: () => {
        void playing.refetch();
      },
    } satisfies Read<PlaybackSession>,
    onTheWay: {
      items: onTheWay(requests.data ?? [], user.id),
      pending: requests.isPending,
      error: requests.data === undefined ? requests.error : null,
      retry: () => {
        void requests.refetch();
      },
    } satisfies Read<OnTheWayTitle>,
    added: {
      items: added.items.slice(0, ADDED_SHOWN),
      pending: added.pending,
      error: added.items.length === 0 ? added.error : null,
      retry: added.retry,
    } satisfies Read<LibraryItem>,
    week: {
      items: thisWeek(calendar.items, today),
      today,
      pending: calendar.pending,
      error: calendar.items.length === 0 ? calendar.error : null,
      retry: calendar.retry,
    } satisfies Read<WeekDay> & { today: string },
    leaving: {
      // Every title that is leaving: the section shows the soonest few.
      items: leaving,
      pending: removals.isPending,
      error: removals.data === undefined ? removals.error : null,
      retry: () => {
        void removals.refetch();
      },
    } satisfies Read<LeavingTitle>,
  };
}

export type HomeReads = ReturnType<typeof useHomeReads>;
