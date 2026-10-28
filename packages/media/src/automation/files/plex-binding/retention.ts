import type {
  PlexAccess,
  PlexBindingFreshness,
  PlexBindingSnapshot,
  PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import type { BoundWatchAuthority } from "#shared/plex-binding/watch.ts";
import type { MovieRemovalScope } from "#automation/files/movie-editions/removal-scope.ts";
import {
  readCurrentPlexBindings,
  readPlexPhysicalGroup,
} from "#infrastructure/plex-binding/read.ts";
import {
  captureQuarantinedPlexWatchScope,
  readQuarantinedPlexWatchAuthority,
  type QuarantinedPlexWatchScope,
} from "#infrastructure/plex-binding/quarantine.ts";
import { assertRetentionPlexProjection } from "#infrastructure/plex-binding/retention.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  FileGuardError,
  type FileContext,
  type RemovalEntry,
  type Transaction,
} from "#automation/files/types.ts";

export type RetentionPlexAuthority = {
  byMedia: ReadonlyMap<string, BoundWatchAuthority>;
  freshness: PlexBindingFreshness;
};

/** Configuration is captured outside the physical transaction, for required kinds only. */
export async function removalPlexAccess(
  context: FileContext,
  plan: readonly RemovalEntry[],
) {
  const kinds = [...new Set(plan.map((entry) => entry.libraryKind))].sort();
  const access: PlexAccess[] = [];
  for (const kind of kinds)
    access.push(await context.plexAccess(kind === "movies" ? "movie" : "show"));
  return access;
}

/** Receipt siblings are discovered before any final physical authority locks. */
export async function captureRemovalQuarantineScopes(
  tx: Transaction,
  input: {
    plan: readonly RemovalEntry[];
    access: readonly PlexAccess[];
    freshness: PlexBindingFreshness;
  },
): Promise<QuarantinedPlexWatchScope[]> {
  const scopes: QuarantinedPlexWatchScope[] = [];
  for (const entry of input.plan) {
    const access = input.access.find(
      (value) =>
        value.sectionType ===
        (entry.libraryKind === "movies" ? "movie" : "show"),
    );
    if (access === undefined) throw new FileGuardError("wrong_section");
    for (const mediaId of entry.mediaIds) {
      const decisions = await tx.retentionDecision.findMany({
        where: { mediaId, edition: "default", state: "quarantined" },
        select: { id: true },
        take: 2,
      });
      input.freshness.assertActive();
      if (decisions.length !== 1 || decisions[0] === undefined)
        throw new FileGuardError("retention_decision_ambiguous");
      const captured = await captureQuarantinedPlexWatchScope(tx, {
        decisionId: decisions[0].id,
        scope: { mediaId, edition: "default" },
        assetId: entry.assetId,
        access,
      });
      input.freshness.assertActive();
      if (captured.status !== "current")
        throw new FileGuardError(captured.reason);
      scopes.push(captured.scope);
    }
  }
  return scopes;
}

/** Caller already owns every manifest member. Never acquire additional roots here. */
export async function readRetentionPlexAuthority(
  tx: Transaction,
  input: {
    plan: readonly RemovalEntry[];
    purge: boolean;
    access: readonly PlexAccess[];
    freshness: PlexBindingFreshness;
    movie?: MovieRemovalScope;
  },
): Promise<RetentionPlexAuthority> {
  const byMedia = new Map<string, BoundWatchAuthority>();
  const groups = new Map<string, PlexPhysicalGroup>();
  const bindings: PlexBindingSnapshot[] = [];
  const decisions: string[] = [];
  for (const entry of input.plan) {
    const access = input.access.find(
      (value) =>
        value.sectionType ===
        (entry.libraryKind === "movies" ? "movie" : "show"),
    );
    if (access === undefined) throw new FileGuardError("wrong_section");
    const current = await readPlexPhysicalGroup(tx, entry.assetId);
    input.freshness.assertActive();
    if (
      identityHash(current.group.coverage.map((scope) => scope.mediaId)) !==
      identityHash([...entry.mediaIds].sort())
    )
      throw new FileGuardError("coverage_changed");
    const serving = input.purge
      ? []
      : await readCurrentPlexBindings(
          tx,
          current.group.coverage.map((scope) => ({
            scope,
            assetId: entry.assetId,
            access,
          })),
          input.movie?.budget,
        );
    input.freshness.assertActive();
    for (const scope of current.group.coverage) {
      const member = await readRetentionMember(tx, {
        scope,
        assetId: entry.assetId,
        access,
        purge: input.purge,
        freshness: input.freshness,
        serving,
        ...(input.movie === undefined ? {} : { movie: input.movie }),
      });
      decisions.push(member.decisionId);
      byMedia.set(scope.mediaId, member.authority);
      groups.set(entry.assetId, member.group);
      bindings.push(member.authority.binding);
    }
  }
  bindings.sort((a, b) => a.scope.mediaId.localeCompare(b.scope.mediaId));
  for (const decisionId of decisions)
    await assertRetentionPlexProjection(
      tx,
      { decisionId, groups: [...groups.values()], bindings },
      input.freshness,
      input.movie?.budget,
    );
  input.freshness.assertActive();
  return { byMedia, freshness: input.freshness };
}

async function readRetentionMember(
  tx: Transaction,
  input: {
    scope: PlexPhysicalGroup["coverage"][number];
    assetId: string;
    access: PlexAccess;
    purge: boolean;
    freshness: PlexBindingFreshness;
    serving: Awaited<ReturnType<typeof readCurrentPlexBindings>>;
    movie?: MovieRemovalScope;
  },
): Promise<{
  decisionId: string;
  authority: BoundWatchAuthority;
  group: PlexPhysicalGroup;
}> {
  if (input.movie === undefined && input.scope.edition !== "default")
    throw new FileGuardError("edition_not_available");
  if (
    input.movie !== undefined &&
    (input.scope.mediaId !== input.movie.scope.mediaId ||
      input.scope.edition !== input.movie.scope.edition)
  )
    throw new FileGuardError("edition_not_available");
  const decision = await tx.retentionDecision.findMany({
    where: {
      ...input.scope,
      state: input.purge ? "quarantined" : "grace_period",
    },
    select: { id: true },
    take: 2,
  });
  input.movie?.budget.consume(decision.length);
  input.freshness.assertActive();
  if (decision.length !== 1 || decision[0] === undefined)
    throw new FileGuardError("retention_decision_ambiguous");
  const decisionId = decision[0].id;
  if (input.purge) {
    const retained = await readQuarantinedPlexWatchAuthority(
      tx,
      {
        decisionId,
        scope: input.scope,
        assetId: input.assetId,
        access: input.access,
      },
      input.movie?.budget,
    );
    input.freshness.assertActive();
    if (retained.status !== "current")
      throw new FileGuardError(retained.reason);
    if (input.movie !== undefined && retained.association.schemaVersion !== 2)
      throw new FileGuardError("edition_not_available");
    return {
      decisionId,
      authority: retained.authority,
      group: retained.association.group,
    };
  }
  const binding = input.serving.find(
    (value) =>
      value.status === "current" &&
      value.snapshot.scope.mediaId === input.scope.mediaId,
  );
  if (binding?.status !== "current")
    throw new FileGuardError("reconciliation_required");
  return {
    decisionId,
    authority: { purpose: "current_serving", binding: binding.snapshot },
    group: binding.association.group,
  };
}
