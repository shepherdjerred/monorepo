import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { LeavingSoonSchema } from "#shared/household/library.ts";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { TitleFacts } from "./primary-action.ts";

/**
 * A removal in progress, as far as the household can still act on it: the
 * files are about to go, or have gone and can be brought back.
 */
type Leaving =
  | { kind: "leaving"; at: string | null }
  | { kind: "recoverable"; until: string | null };

/**
 * The newest removal decision of a title. The library calls two of its
 * states "leaving soon"; the earlier ones are the system still deciding and
 * say nothing to the household.
 */
export function leavingOf(
  media: Pick<MediaDetail, "retention">,
): Leaving | null {
  const decision = media.retention[0];
  if (decision === undefined) return null;
  if (decision.state === "quarantined") {
    return { kind: "recoverable", until: decision.purgeAfter };
  }
  return LeavingSoonSchema.shape.state.safeParse(decision.state).success
    ? { kind: "leaving", at: decision.graceUntil }
    : null;
}

type OwnRequest = DefaultTargetView["ownRequests"][number];

/**
 * The reader's request that "Cancel request" withdraws. The owner may cancel
 * through the title's own permission; a member only a request that says so.
 */
export function cancellableRequest(
  context: DefaultTargetView,
  user: MediaUser,
): OwnRequest | undefined {
  const owner =
    user.role === "owner" &&
    context.allowedProtectiveActions.includes("cancel_request");
  return context.ownRequests.find(
    (request) => request.active && (owner || request.canCancel),
  );
}

/** The reader's interest in a title, as an interest command names it. */
type OwnInterest = {
  requestId: string;
  version: number;
  interestRevision: number;
  /** Whether the request itself keeps the title for good; null when not told. */
  keepingPolicy: "keep" | "temporary" | null;
};

type Requested = Pick<MediaDetail, "requests">;

/**
 * The detail read lists only the requests that still follow the title: one
 * whose interest was let go, or ran out, is not among them even though the
 * request itself still stands.
 */
function listedAsFollowing(media: Requested, user: MediaUser): boolean {
  return media.requests.some((request) => request.userId === user.id);
}

/**
 * The reader's own interest in this very row: the one "Stop following" lets
 * go. A row that a series or season request covers has none of its own; that
 * interest is on the request for the series or season.
 */
export function ownInterest(
  media: Requested,
  user: MediaUser,
): OwnInterest | undefined {
  for (const request of media.requests) {
    if (
      request.userId === user.id &&
      request.interestState === "following" &&
      request.interestRevision !== null
    ) {
      return {
        requestId: request.id,
        version: request.version,
        interestRevision: request.interestRevision,
        keepingPolicy: request.keepingPolicy,
      };
    }
  }
  return undefined;
}

/**
 * An interest can be let go only while its request keeps the title just for
 * now: the server refuses to drop one that keeps it for good.
 */
function mayStopFollowing(media: Requested, user: MediaUser): boolean {
  return ownInterest(media, user)?.keepingPolicy === "temporary";
}

/**
 * The owner's keeping switch, on the page of the film or series it belongs
 * to. A season or an episode reports its series' switch, which is changed on
 * the series' page.
 */
function keepingSwitch(
  media: Pick<MediaDetail, "id" | "rootMediaId" | "libraryKeeping">,
): TitleFacts["keeping"] {
  return media.id === media.rootMediaId
    ? (media.libraryKeeping?.keepingPolicy ?? null)
    : null;
}

/** Where the reader stands with a series, season or episode. */
export function televisionFacts(
  media: MediaDetail,
  context: DefaultTargetView,
  user: MediaUser,
): TitleFacts {
  const allowed = context.allowedProtectiveActions;
  const owner = user.role === "owner";
  const asked = context.ownRequests.some((request) => request.active);
  const following = asked && listedAsFollowing(media, user);
  return {
    availability: media.availability,
    role: user.role,
    following,
    mayStopFollowing: following && mayStopFollowing(media, user),
    canCancel: cancellableRequest(context, user) !== undefined,
    leavingSoon: leavingOf(media)?.kind === "leaving",
    pinned: media.holds.some((hold) => hold.isPin && hold.userId === user.id),
    keptForGood: media.policy === "keep",
    keeping: keepingSwitch(media),
    mayHold: allowed.includes("keep"),
    mayPin: allowed.includes("pin"),
    mayUnpin: allowed.includes("unpin"),
    // Bringing files back is for whoever asked for the title, or the owner.
    mayRestore: media.availability === "quarantined" && (owner || asked),
    // The owner can ask again on behalf of a profile they manage.
    mayRequestAgain: owner,
  };
}

/** The reader's request for one version of a film that can be withdrawn. */
export function cancellableVersionRequest(version: MovieTargetContextV4) {
  return version.ownRequests.find(
    (request) => request.active && request.canCancel,
  );
}

/**
 * Where the reader stands with one version of a film. Only the standard
 * version takes part in the library's removals and its keeping, and only its
 * request has an interest the detail read reports: any other version is
 * followed for as long as its request stands.
 */
export function versionFacts(
  version: MovieTargetContextV4,
  media: Pick<
    MediaDetail,
    | "id"
    | "rootMediaId"
    | "retention"
    | "availability"
    | "requests"
    | "policy"
    | "libraryKeeping"
  >,
  user: MediaUser,
): TitleFacts {
  const protective = version.allowedProtectiveActions;
  const standard = version.scope.edition === "default";
  const asked = version.ownRequests.some((request) => request.active);
  const following = asked && (!standard || listedAsFollowing(media, user));
  return {
    availability:
      version.access === "detail"
        ? version.target.availability
        : media.availability,
    role: user.role,
    following,
    mayStopFollowing: standard && following && mayStopFollowing(media, user),
    canCancel: cancellableVersionRequest(version) !== undefined,
    leavingSoon: standard && leavingOf(media)?.kind === "leaving",
    pinned: version.ownHold?.isPin === true,
    keptForGood: standard && media.policy === "keep",
    keeping: standard ? keepingSwitch(media) : null,
    mayHold: protective.includes("keep"),
    mayPin: protective.includes("pin"),
    mayUnpin: protective.includes("unpin"),
    mayRestore:
      version.access === "detail" && version.allowedActions.includes("restore"),
    // A film can always be asked for in another version.
    mayRequestAgain: true,
  };
}
