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

/** Where the reader stands with a series, season or episode. */
export function televisionFacts(
  media: MediaDetail,
  context: DefaultTargetView,
  user: MediaUser,
): TitleFacts {
  const allowed = context.allowedProtectiveActions;
  const owner = user.role === "owner";
  const following = context.ownRequests.some((request) => request.active);
  const asked = media.requests.some((request) => request.userId === user.id);
  return {
    availability: media.availability,
    role: user.role,
    following,
    canCancel: cancellableRequest(context, user) !== undefined,
    leavingSoon: leavingOf(media)?.kind === "leaving",
    pinned: media.holds.some((hold) => hold.isPin && hold.userId === user.id),
    mayHold: allowed.includes("keep"),
    mayPin: allowed.includes("pin"),
    mayUnpin: allowed.includes("unpin"),
    // Bringing files back is for whoever asked for the title, or the owner.
    mayRestore:
      media.availability === "quarantined" && (owner || following || asked),
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
 * version takes part in the library's removals, so only it can be leaving.
 */
export function versionFacts(
  version: MovieTargetContextV4,
  media: Pick<MediaDetail, "retention" | "availability">,
  user: MediaUser,
): TitleFacts {
  const protective = version.allowedProtectiveActions;
  const standard = version.scope.edition === "default";
  return {
    availability:
      version.access === "detail"
        ? version.target.availability
        : media.availability,
    role: user.role,
    following: version.ownRequests.some((request) => request.active),
    canCancel: cancellableVersionRequest(version) !== undefined,
    leavingSoon: standard && leavingOf(media)?.kind === "leaving",
    pinned: version.ownHold?.isPin === true,
    mayHold: protective.includes("keep"),
    mayPin: protective.includes("pin"),
    mayUnpin: protective.includes("unpin"),
    mayRestore:
      version.access === "detail" && version.allowedActions.includes("restore"),
    // A film can always be asked for in another version.
    mayRequestAgain: true,
  };
}
