import type { Prisma } from "#generated/prisma/client.ts";
import type { NativePlexParent } from "#shared/plex-binding/native.ts";
import type { PlexCanonicalTarget } from "#shared/plex-binding/canonical.ts";
import {
  PlexPhysicalGroupSchema,
  plexScopeKey,
  type PlexAccess,
} from "#shared/plex-binding/contract.ts";
import { readPlexDefinition } from "#infrastructure/plex-binding/read.ts";
import { nativeCompensationCatalogExpected } from "#infrastructure/plex-binding/native/native-catalog.ts";
import { associationHash } from "#automation/publication/association/projection.ts";
import type { NativeCatalogGroup } from "./selection.ts";
import {
  nativeAbsentPaths,
  nativePlaybackFiles,
} from "#shared/plex-binding/native-scope.ts";

export type NativeScope = NativePlexParent["scope"];

export async function prepareNativeCatalog(
  tx: Prisma.TransactionClient,
  input: {
    scope: NativeScope;
    rawScope: unknown;
    scopeHash: string;
    canonicalTargets: readonly PlexCanonicalTarget[];
    access: readonly PlexAccess[];
  },
) {
  const { scope, canonicalTargets, access } = input;
  if (
    associationHash(
      canonicalTargets.map((target) => target.scope.mediaId).sort(),
    ) !== associationHash(scope.media.map((media) => media.id).sort())
  )
    throw new Error("Native catalog omitted reviewed canonical targets");
  const configured = (kind: "movies" | "tv") => {
    const matches = access.filter(
      (value) => value.sectionType === (kind === "movies" ? "movie" : "show"),
    );
    const value = matches[0];
    if (value === undefined || matches.length !== 1)
      throw new Error("Native configured library missing");
    return value;
  };
  const compensation =
    scope.schemaVersion === 2 &&
    scope.lifecycleKind === "publication_compensation"
      ? nativeCompensationCatalogExpected(input)
      : undefined;
  const present = nativePlaybackFiles(scope);
  const groups: NativeCatalogGroup[] = [];
  const physical = new Map<
    string,
    ReturnType<typeof PlexPhysicalGroupSchema.parse>
  >();
  const definitions = new Map<
    string,
    Awaited<ReturnType<typeof readPlexDefinition>>
  >();
  for (const file of present) {
    const targets = canonicalTargets
      .filter((target) => file.mediaIds.includes(target.scope.mediaId))
      .sort((a, b) =>
        plexScopeKey(a.scope).localeCompare(plexScopeKey(b.scope)),
      );
    const root = targets[0]?.canonicalRootId;
    if (
      root === undefined ||
      targets.length !== file.mediaIds.length ||
      targets.some((target) => target.canonicalRootId !== root)
    )
      throw new Error("Native physical file lost complete canonical coverage");
    const coverage = targets.map((target) => target.scope);
    physical.set(
      file.canonicalPath,
      PlexPhysicalGroupSchema.parse({
        assetId: file.assetId,
        assetVersion: file.assetVersion,
        checksum: file.checksum,
        sizeBytes: file.sizeBytes,
        canonicalPath: file.canonicalPath,
        ownershipEpoch: file.ownershipEpoch,
        canonicalRootId: root,
        edition: "default",
        coverage,
        coverageHash: associationHash(coverage),
      }),
    );
    for (const target of targets)
      definitions.set(
        plexScopeKey(target.scope),
        await readPlexDefinition(tx, target.scope, root),
      );
    groups.push({
      canonicalPath: file.canonicalPath,
      access: configured(file.libraryKind),
      targets,
      allowedSizes: [file.sizeBytes],
      required: true,
    });
  }
  if (compensation !== undefined) {
    appendCompensationGroups(scope, compensation, groups);
  }
  const absent = nativeAbsentPaths(scope);
  const paths = [
    ...new Set([
      ...scope.files.map((file) => file.canonicalPath),
      ...absent.flatMap((value) => value.paths),
    ]),
  ].sort();
  if (
    new Set(groups.map((group) => group.canonicalPath)).size !== groups.length
  )
    throw new Error("Native catalog groups overlap");
  return {
    groups,
    physical,
    definitions,
    compensation,
    absent,
    paths,
    access: [...access],
    canonicalTargets: [...canonicalTargets],
  };
}

function appendCompensationGroups(
  scope: NativeScope,
  compensation: ReturnType<typeof nativeCompensationCatalogExpected>,
  groups: NativeCatalogGroup[],
) {
  if (
    scope.schemaVersion !== 2 ||
    scope.lifecycleKind !== "publication_compensation"
  )
    throw new Error("Native compensation descriptor disappeared");
  for (const descriptor of compensation) {
    const entry = scope.entries.find(
      (value) => value.entry.operationId === descriptor.entryOperationId,
    );
    if (entry?.predecessor == null)
      throw new Error("Native compensation predecessor missing");
    groups.push({
      canonicalPath: descriptor.canonicalPath,
      access: descriptor.access,
      targets: descriptor.targets,
      allowedSizes: [entry.predecessor.sizeBytes, entry.entry.sizeBytes],
      required: false,
    });
  }
}

export type NativeCatalogScope = Awaited<
  ReturnType<typeof prepareNativeCatalog>
>;
