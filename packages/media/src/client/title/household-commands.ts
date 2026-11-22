import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import {
  LibraryKeepingResultSchema,
  RequestInterestResultSchema,
  type LibraryKeepingCommand,
  type RequestInterestCommand,
} from "#shared/household/interests.ts";
import {
  INTEREST_ACTION_NAMES,
  LIBRARY_VIEW_NAMES,
} from "#shared/household/names.ts";
import { ApiError, queryClient, writeApi } from "#client/api.ts";
import { invalidateMovieTargetV4 } from "#client/movie-editions/target-api-v4.ts";
import { invalidateTarget } from "#client/target-controls/api.ts";
import { commandNeedsReview } from "#client/target-controls/errors.tsx";
import {
  confirmation,
  outcomeUnknown,
  type CommandRunner,
  type Part,
} from "./commands.tsx";
import type { HouseholdCommand, TargetCommand } from "./copy.ts";
import { ownInterest } from "./facts.ts";

type Title = Pick<
  MediaDetail,
  "id" | "kind" | "rootMediaId" | "libraryKeeping" | "requests"
>;

/**
 * Reads again everything the page shows about the title, and the lists that
 * repeat it. A household command waits for this, so by the time it reports,
 * what is on the page is what the server holds: after a success, and after a
 * refusal too.
 */
async function rereadTitle(title: Title): Promise<void> {
  await Promise.all([
    invalidateTarget(title.id),
    ...(title.kind === "movie" ? [invalidateMovieTargetV4(title.id)] : []),
    ...[
      "library",
      "calendar",
      "request-interests",
      "request-interest-progress",
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  ]);
}

/** A refusal the page expects, told in the reader's words. */
type Refusals = ReadonlyMap<string, string>;

function refusalOf(error: Error | null, known: Refusals): string | null {
  return error instanceof ApiError ? (known.get(error.code) ?? null) : null;
}

/** One household write, as the runner sees it. */
type HouseholdPart = Part & { notice: string | null };

function householdPart(
  mutation: {
    isPending: boolean;
    isSuccess: boolean;
    error: Error | null;
    reset: () => void;
  },
  known: Refusals,
  resend: (() => void) | null,
): HouseholdPart {
  const notice = refusalOf(mutation.error, known);
  const unknown = outcomeUnknown(mutation.error);
  const unexplained = notice === null ? mutation.error : null;
  return {
    // A refusal the page explained has been read past already, so the reader
    // may choose again; any other leaves the buttons until it is looked at.
    busy: mutation.isPending || unknown || commandNeedsReview(unexplained),
    isPending: mutation.isPending,
    finished: mutation.isSuccess ? "completed" : null,
    error: unexplained,
    notice,
    retry: unknown ? resend : null,
    review: mutation.reset,
  };
}

const KEEPING_REFUSALS: Refusals = new Map([
  [
    "version_conflict",
    "This title changed before Media got that, so how long it is kept was not changed. The page now shows where it stands; choose again if you still want to.",
  ],
]);

/**
 * The owner's keeping switch: the same command the Library's list sends,
 * against the versions the title was read at.
 */
function useKeeping(user: MediaUser, title: Title) {
  const mutation = useMutation({
    mutationFn: (command: LibraryKeepingCommand) =>
      writeApi({
        actorId: user.id,
        path: `/library/${encodeURIComponent(command.mediaId)}/keeping-policy`,
        body: command,
        schema: LibraryKeepingResultSchema,
      }),
    onSettled: () => rereadTitle(title),
  });
  const sent = mutation.variables;
  return {
    part: householdPart(
      mutation,
      KEEPING_REFUSALS,
      sent === undefined
        ? null
        : () => {
            mutation.mutate(sent);
          },
    ),
    submit: (keepingPolicy: LibraryKeepingCommand["keepingPolicy"]) => {
      const keeping = title.libraryKeeping;
      if (keeping === null) {
        throw new Error("This title has no keeping switch");
      }
      mutation.mutate({
        schemaVersion: 1,
        mediaId: title.rootMediaId,
        edition: "default",
        expectedMediaVersion: keeping.mediaVersion,
        expectedTargetVersion: keeping.targetVersion,
        keepingPolicy,
      });
    },
  };
}

/** What stands in the way of letting go a request that keeps its title. */
const KEEP_PROTECTED = {
  owner: `Your request keeps this for good, so you still follow it. Change the request to ${INTEREST_ACTION_NAMES.temporary} under ${LIBRARY_VIEW_NAMES.mine} in the Library first.`,
  member:
    "Your request keeps this for good, so you still follow it. Only the owner can change how long it is kept.",
} as const satisfies Record<MediaUser["role"], string>;

function stopRefusals(role: MediaUser["role"]): Refusals {
  return new Map([
    [
      "version_conflict",
      `Your request changed before Media got that, so you still follow this. The page now shows the request as it stands; choose ${INTEREST_ACTION_NAMES.drop} again if you still want to.`,
    ],
    ["keep_protected", KEEP_PROTECTED[role]],
  ]);
}

/**
 * Letting the reader's own interest go: the interest's `drop` command, as
 * the Library's Mine view sends it, at the revision the title was read at.
 */
function useStopFollowing(user: MediaUser, title: Title) {
  const mutation = useMutation({
    mutationFn: (command: RequestInterestCommand) =>
      writeApi({
        actorId: user.id,
        path: `/request-interests/${encodeURIComponent(command.requestId)}/commands`,
        body: command,
        schema: RequestInterestResultSchema,
      }),
    onSettled: () => rereadTitle(title),
  });
  const sent = mutation.variables;
  return {
    part: householdPart(
      mutation,
      stopRefusals(user.role),
      sent === undefined
        ? null
        : () => {
            mutation.mutate(sent);
          },
    ),
    submit: () => {
      const interest = ownInterest(title, user);
      if (interest === undefined) {
        throw new Error("There is no interest of yours to let go");
      }
      mutation.mutate({
        schemaVersion: 1,
        requestId: interest.requestId,
        expectedVersion: interest.version,
        expectedInterestRevision: interest.interestRevision,
        action: "drop",
      });
    },
  };
}

/**
 * Every command a title page can send, as one runner: the commands against
 * the title's own target, which differ between a film and a series, and the
 * household's, which do not.
 *
 * One command at a time. What the runner reports is about the command that
 * ran last, so an earlier confirmation never stands beside a later refusal.
 */
export function useTitleRunner(
  user: MediaUser,
  title: Title,
  target: CommandRunner<TargetCommand>,
): CommandRunner {
  const keeping = useKeeping(user, title);
  const stop = useStopFollowing(user, title);
  const [last, setLast] = useState<HouseholdCommand | null>(null);
  const stopped = last === "stop_following" ? stop.part : keeping.part;
  const part = last === null ? null : stopped;
  return {
    run: (command) => {
      switch (command) {
        case "keep_for_good": {
          setLast(command);
          keeping.submit("keep");
          break;
        }
        case "keep_for_now": {
          setLast(command);
          keeping.submit("temporary");
          break;
        }
        case "stop_following": {
          setLast(command);
          stop.submit();
          break;
        }
        case "hold":
        case "pin":
        case "unpin":
        case "cancel_request":
        case "restore": {
          setLast(null);
          target.run(command);
          break;
        }
      }
    },
    busy: target.busy || keeping.part.busy || stop.part.busy,
    pending: part === null ? target.pending : part.isPending ? last : null,
    done: part === null ? target.done : confirmation(last, part.finished),
    error: part === null ? target.error : part.error,
    notice: part?.notice ?? null,
    retry: part === null ? target.retry : part.retry,
    review: () => {
      keeping.part.review();
      stop.part.review();
      target.review();
      void rereadTitle(title);
    },
  };
}
