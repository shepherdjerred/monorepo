import {
  PlexCanonicalTargetSchema,
  type PlexCanonicalTarget,
} from "#shared/plex-binding/canonical.ts";
import {
  PlexServingExpectedProtocolSchema,
  type PlexServingExpected,
} from "#shared/plex-binding/library.ts";
import {
  PlexAccessSchema,
  plexScopeKey,
  type PlexAccess,
  type PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { ServingVerificationInput } from "./types.ts";

function assertServingPurpose(purpose: string) {
  if (purpose !== "current_serving")
    throw new PlexBindingProtection("scope_changed");
}

function assertCanonicalTargets(
  expected: PlexServingExpected,
  canonical: readonly PlexCanonicalTarget[],
  movieEditions: boolean,
) {
  const byScope = new Map(
    canonical.map((row) => [plexScopeKey(row.scope), row]),
  );
  if (
    byScope.size !== canonical.length ||
    canonical.length !== expected.targets.length ||
    (!movieEditions &&
      expected.targets.some((row) => row.scope.edition !== "default")) ||
    (movieEditions &&
      (canonical.length !== 1 || canonical[0]?.kind !== "movie"))
  ) {
    throw new PlexBindingProtection("scope_changed");
  }
  for (const row of expected.targets) {
    const target = byScope.get(plexScopeKey(row.scope));
    if (
      target?.canonicalRootId !== row.editionRootId ||
      target.canonicalIdentityHash !== row.canonicalIdentityHash ||
      target.numberingHash !== row.numberingHash
    ) {
      throw new PlexBindingProtection("scope_changed");
    }
    if (
      target.kind === "episode" &&
      (target.coordinate.mediaId !== row.scope.mediaId ||
        target.coordinate.seriesId !== row.editionRootId ||
        target.coordinate.mediaVersion !== row.mediaVersion)
    ) {
      throw new PlexBindingProtection("scope_changed");
    }
  }
  return byScope;
}

function assertServingAccess(
  access: readonly PlexAccess[],
  requiredTypes: ReadonlySet<"movie" | "show">,
) {
  if (
    access.length !== requiredTypes.size ||
    access.some((row) => !requiredTypes.has(row.sectionType)) ||
    access.length === 0 ||
    access.length > 2 ||
    new Set(access.map((row) => row.serverMachineId)).size !== 1 ||
    new Set(access.map((row) => row.sectionType)).size !== access.length ||
    new Set(access.map((row) => row.sectionId)).size !== access.length
  ) {
    throw new PlexBindingProtection("wrong_section");
  }
}

/** Trusted producer schemas stay loud; legitimate changed snapshots protect. */
export function servingScope(
  input: ServingVerificationInput,
  movieEditions = false,
) {
  const expected = PlexServingExpectedProtocolSchema.parse(input.expected);
  const canonical = input.canonicalTargets.map((row) =>
    PlexCanonicalTargetSchema.parse(row),
  );
  const access = input.access.map((row) => PlexAccessSchema.parse(row));
  if (snapshotHash(access) !== snapshotHash(expected.access)) {
    throw new PlexBindingProtection("wrong_section");
  }
  const canonicalByScope = assertCanonicalTargets(
    expected,
    canonical,
    movieEditions,
  );
  assertServingPurpose(input.purpose);
  if (expected.newGroups.length === 0) {
    throw new PlexBindingProtection("scope_changed");
  }
  const targets = new Map(
    expected.targets.map((row) => [plexScopeKey(row.scope), row]),
  );
  const groups = new Map<string, PlexPhysicalGroup>();
  const requiredTypes = new Set<"movie" | "show">();
  for (const group of expected.newGroups) {
    for (const member of group.coverage) {
      const key = plexScopeKey(member),
        target = canonicalByScope.get(key);
      if (
        groups.has(key) ||
        target?.canonicalRootId !== group.canonicalRootId ||
        (target.kind === "movie" && group.coverage.length !== 1)
      ) {
        throw new PlexBindingProtection("scope_changed");
      }
      requiredTypes.add(target.kind === "movie" ? "movie" : "show");
      groups.set(key, group);
    }
  }
  if (groups.size > 10_000) {
    throw new PlexBindingProtection("scope_changed");
  }
  assertServingAccess(access, requiredTypes);
  const serverMachineId = access[0]?.serverMachineId;
  if (serverMachineId === undefined) {
    throw new Error("Serving access missing");
  }
  return {
    expected,
    canonicalByScope,
    targets,
    groups,
    access,
    serverMachineId,
  };
}

export type ServingScope = ReturnType<typeof servingScope>;
