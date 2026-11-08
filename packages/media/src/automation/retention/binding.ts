import { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type {
  PlexAccess,
  PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import {
  captureWatchBindingScope,
  readWatchBinding,
  type WatchBindingScope,
  type WatchBinding,
} from "#automation/plex-events/binding.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { readCurrentBoundWatch } from "#infrastructure/plex-binding/watch.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export type BoundMediaCohort = {
  mediaIds: string[];
  scopes: WatchBindingScope[];
  original: WatchBinding[];
  access: PlexAccess[];
  movieScope?: MovieEditionScope;
  budget?: PublicationAuthorityReadBudget;
};

function boundSectionType(
  kind: string,
  movieScope?: MovieEditionScope,
): "movie" | "show" {
  if (kind !== "movie" && kind !== "episode")
    throw new PlexBindingProtection("scope_changed");
  if (movieScope !== undefined && kind !== "movie")
    throw new PlexBindingProtection("scope_changed");
  return kind === "movie" ? "movie" : "show";
}

function assertMovieCohort(
  mediaIds: readonly string[],
  scope?: MovieEditionScope,
) {
  if (
    scope !== undefined &&
    (mediaIds.length !== 1 ||
      mediaIds[0] !== scope.mediaId ||
      scope.rootMediaId !== scope.mediaId)
  )
    throw new PlexBindingProtection("scope_changed");
}

/** Expand complete current/retained groups before any root, never during final authorization. */
export async function prepareBoundMediaCohort(
  context: Pick<MediaAutomationContext, "db" | "plexAccess">,
  mediaIds: readonly string[],
  guard: { assertActive: () => void; budget?: PublicationAuthorityReadBudget },
  movieScope?: MovieEditionScope,
): Promise<BoundMediaCohort> {
  assertMovieCohort(mediaIds, movieScope);
  const pending = new Set(mediaIds);
  const scopes = new Map<string, WatchBindingScope>();
  const original = new Map<string, WatchBinding>();
  const access = new Map<"movie" | "show", PlexAccess>();
  for (const mediaId of pending) {
    guard.assertActive();
    if (pending.size > 10_000) throw new PlexBindingProtection("scope_changed");
    const media = await context.db.mediaItem.findUniqueOrThrow({
      where: { id: mediaId },
      select: { kind: true },
    });
    guard.assertActive();
    const kind = boundSectionType(media.kind, movieScope);
    let configured = access.get(kind);
    if (configured === undefined) {
      configured = await context.plexAccess(kind);
      guard.assertActive();
      access.set(kind, configured);
    }
    const scope = await captureWatchBindingScope(
      context.db,
      mediaId,
      configured,
      { edition: movieScope?.edition, budget: guard.budget },
    );
    guard.assertActive();
    if (scope === null)
      throw new PlexBindingProtection("reconciliation_required");
    assertMovieCohort(scope.mediaIds, movieScope);
    const binding = await readWatchBinding(context.db, scope, guard.budget);
    guard.assertActive();
    if (binding === null) throw new PlexBindingProtection("missing_binding");
    scopes.set(mediaId, scope);
    original.set(mediaId, binding);
    for (const id of scope.mediaIds) pending.add(id);
  }
  const ids = [...pending].sort();
  return {
    mediaIds: ids,
    scopes: ids.map((id) => {
      const scope = scopes.get(id);
      if (scope === undefined) throw new Error("Bound cohort omitted a scope");
      return scope;
    }),
    original: ids.map((id) => {
      const binding = original.get(id);
      if (binding === undefined)
        throw new Error("Bound cohort omitted its association");
      return binding;
    }),
    access: [...access.values()].sort((a, b) =>
      a.sectionType.localeCompare(b.sectionType),
    ),
    ...(movieScope === undefined ? {} : { movieScope }),
    ...(guard.budget === undefined ? {} : { budget: guard.budget }),
  };
}

/** Caller holds the complete original union; changing membership never acquires another root. */
export async function assertBoundMediaCohort(
  tx: Prisma.TransactionClient,
  prepared: BoundMediaCohort,
  guard: { assertActive: () => void },
) {
  const bindings: WatchBinding[] = [];
  for (const [index, scope] of prepared.scopes.entries()) {
    const current = await readWatchBinding(tx, scope, prepared.budget);
    guard.assertActive();
    const original = prepared.original[index];
    if (
      current === null ||
      original === undefined ||
      identityHash(current.authority) !== identityHash(original.authority)
    )
      throw new PlexBindingProtection("binding_changed");
    bindings.push(current);
  }
  const groups = new Map<string, PlexPhysicalGroup>();
  for (const binding of bindings) {
    const group = binding.association.group;
    const prior = groups.get(group.assetId);
    if (prior !== undefined && identityHash(prior) !== identityHash(group))
      throw new Error("Bound cohort disagrees on a physical group");
    groups.set(group.assetId, group);
  }
  return {
    members: bindings,
    groups: [...groups.values()].sort((a, b) =>
      a.assetId.localeCompare(b.assetId),
    ),
    bindings: bindings.map((value) => value.authority.binding),
  };
}

export async function boundRequesterWatch(
  tx: Prisma.TransactionClient,
  binding: WatchBinding,
  userId: string,
  budget?: PublicationAuthorityReadBudget,
) {
  const watch = await readCurrentBoundWatch(
    tx,
    { userId, authority: binding.authority },
    budget,
  );
  return watch.status === "known" ? watch.projection : null;
}

/** Called after roots, targets, claims, runtime and the complete sorted identity cohort. */
export async function lockBoundCohortRows(
  tx: Prisma.TransactionClient,
  cohort: BoundMediaCohort,
  guard: { assertActive: () => void },
) {
  const assets = [
    ...new Set(cohort.scopes.flatMap((scope) => scope.assetIds)),
  ].sort();
  const continuations = [
    ...new Set(
      cohort.scopes.flatMap((scope) => scope.quarantine?.continuationIds ?? []),
    ),
  ].sort();
  guard.assertActive();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(assets)}) ORDER BY id FOR UPDATE`,
  );
  guard.assertActive();
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(assets)}) ORDER BY "assetId","mediaId" FOR SHARE`,
  );
  guard.assertActive();
  if (continuations.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "NativeQuarantineContinuation" WHERE id IN (${Prisma.join(continuations)}) ORDER BY id FOR UPDATE`,
    );
  guard.assertActive();
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "WatchObservationFence" WHERE "mediaId" IN (${Prisma.join(cohort.mediaIds)}) AND edition=${cohort.movieScope?.edition ?? "default"} ORDER BY "mediaId" FOR SHARE`,
  );
  guard.assertActive();
}
