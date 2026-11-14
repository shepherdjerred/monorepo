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
