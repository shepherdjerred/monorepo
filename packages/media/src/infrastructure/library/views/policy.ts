import type { Prisma } from "#generated/prisma/client.ts";
import type { LibraryReadSettings } from "./plex-access.ts";
import { coveredSeriesWhere, type EpisodeAccess } from "./series-episodes.ts";

type Claim = {
  userId: string;
  active: boolean;
  excluded: boolean;
  keepingPolicy: "keep" | "temporary";
  interestState: string;
};
type Target = {
  libraryKeep: boolean;
  libraryPolicyExplicit: boolean;
  edition: string;
};
export type LibraryPolicyNode = {
  id: string;
  intents: Target[];
  requests: Claim[];
  parent?: (LibraryPolicyNode & { parent?: LibraryPolicyNode | null }) | null;
};

/** Explicit Temporary overrides migrated defaults; any explicit Keep protects the tree. */
export function libraryViewPolicy(media: LibraryPolicyNode, actorId: string) {
  const ancestry: LibraryPolicyNode[] = [media];
  if (media.parent != null) ancestry.push(media.parent);
  if (media.parent?.parent != null) ancestry.push(media.parent.parent);
  const targets = ancestry.flatMap((row) =>
    row.intents.filter((intent) => intent.edition === "default"),
  );
  const explicit = targets.find((target) => target.libraryPolicyExplicit);
  const claims = ancestry
    .flatMap((row) => row.requests)
    .filter((claim) => claim.active && !claim.excluded);
  const libraryKeep =
    targets.some(
      (target) => target.libraryPolicyExplicit && target.libraryKeep,
    ) ||
    (explicit === undefined && targets.some((target) => target.libraryKeep));
  const kept =
    libraryKeep || claims.some((claim) => claim.keepingPolicy === "keep");
  const following = claims.some(
    (claim) => claim.userId === actorId && claim.interestState === "following",
  );
  return {
    kept,
    following,
    householdFollowing: claims.some(
      (claim) => claim.interestState === "following",
    ),
  };
}

type KeepingTitle = Omit<LibraryPolicyNode, "intents"> & {
  version: number;
  intents: (Target & { version: number })[];
};

/**
 * What a movie or series reports about how long the household keeps it. The
 * library list and the title read both report exactly this, so the keeping
 * switch means the same thing wherever it is shown. `libraryKeeping` is the
 * owner's switch over the default edition; nobody else reads it.
 */
export function libraryKeepingView(
  media: KeepingTitle,
  reader: { actorId: string; owner: boolean },
) {
  const claims = libraryViewPolicy(media, reader.actorId);
  const target = media.intents.find((intent) => intent.edition === "default");
  return {
    claims,
    ...keepingLabels(claims),
    libraryKeeping:
      target !== undefined && reader.owner
        ? {
            mediaVersion: media.version,
            targetVersion: target.version,
            keepingPolicy: target.libraryKeep
              ? ("keep" as const)
              : ("temporary" as const),
          }
        : null,
  };
}

function keepingLabels(claims: ReturnType<typeof libraryViewPolicy>) {
  if (claims.kept)
    return { policy: "keep", protection: "keep_indefinitely" } as const;
  return claims.householdFollowing
    ? ({ policy: "temporary", protection: "temporary_interest" } as const)
    : ({ policy: "unclassified", protection: "review_required" } as const);
}

/** What the actor's own claims on a title amount to; any past claim counts as released. */
export function libraryInterest(
  media: { requests: readonly { userId: string }[] },
  policy: { following: boolean },
  actorId: string,
): "following" | "released" | "none" {
  if (policy.following) return "following";
  return media.requests.some((claim) => claim.userId === actorId)
    ? "released"
    : "none";
}

const standingClaim = { active: true, excluded: false } as const;
const keptWhere = {
  OR: [
    { intents: { some: { edition: "default", libraryKeep: true } } },
    { requests: { some: { ...standingClaim, keepingPolicy: "keep" } } },
  ],
} satisfies Prisma.MediaItemWhereInput;
const householdFollowingWhere = {
  requests: { some: { ...standingClaim, interestState: "following" } },
} satisfies Prisma.MediaItemWhereInput;

/**
 * `libraryViewPolicy` as a filter, exact for a movie or series: a root title
 * has no ancestors and one default target, so its own target and claims decide
 * it. Do not apply it to a season or episode, whose policy is inherited.
 */
export function libraryPolicyWhere(
  policy: "keep" | "temporary" | "unclassified",
): Prisma.MediaItemWhereInput {
  if (policy === "keep") return keptWhere;
  return policy === "temporary"
    ? { AND: [{ NOT: keptWhere }, householdFollowingWhere] }
    : { NOT: { OR: [keptWhere, householdFollowingWhere] } };
}

/** The root titles on which `libraryViewPolicy` reports the actor `following`. */
export function libraryFollowingWhere(
  actorId: string,
): Prisma.MediaItemWhereInput {
  return {
    requests: {
      some: { ...standingClaim, userId: actorId, interestState: "following" },
    },
  };
}

/** A title is in the household library while something holds it there. */
export function libraryMemberWhere(
  settings: LibraryReadSettings,
  plexIdentity: EpisodeAccess | null,
): Prisma.MediaItemWhereInput {
  const coveredSeries = coveredSeriesWhere(settings, plexIdentity);
  return {
    OR: [
      { intents: { some: { libraryKeep: true } } },
      { requests: { some: { active: true, excluded: false } } },
      { assets: { some: { current: true } } },
      ...(coveredSeries === null ? [] : [coveredSeries]),
    ],
  };
}

export const libraryPolicyInclude = {
  intents: { where: { edition: "default" } },
  requests: {
    select: {
      userId: true,
      active: true,
      excluded: true,
      keepingPolicy: true,
      interestState: true,
    },
  },
} as const;
export const libraryViewInclude = {
  ...libraryPolicyInclude,
  parent: {
    include: {
      ...libraryPolicyInclude,
      parent: { include: libraryPolicyInclude },
    },
  },
} as const;
