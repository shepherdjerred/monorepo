import { z } from "zod";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import {
  NativePlexObservationSchema,
  type NativePlexNetworkEvidence,
} from "#shared/plex-binding/native.ts";
import {
  nativeAbsentPaths,
  nativePlaybackFiles,
  type NativeCatalogScopeSnapshot,
} from "#shared/plex-binding/native-scope.ts";
import {
  matchesReferences,
  type PlexCanonicalTarget,
} from "#shared/plex-binding/canonical.ts";
import {
  plexScopeKey,
  type PlexAssociationV1,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import {
  assertNativeCompensationCatalog,
  assertNativeCompensationCatalogNetwork,
} from "./native-catalog.ts";

/** Validate literal snapshots before parsing. Historical reads never consult today's catalog. */
export function assertNativePlexObservation(input: {
  rawScope: unknown;
  rawObservation: unknown;
  network: NativePlexNetworkEvidence;
}) {
  const raw = z
    .object({
      parent: z.object({
        scopeHash: z.string(),
        purpose: z.string(),
        networkScopeHash: z.string().optional(),
      }),
      effectiveScope: z.json().optional(),
    })
    .parse(input.rawObservation);
  if (identityHash(input.rawScope) !== raw.parent.scopeHash)
    throw new Error("Native observation original scope hash changed");
  if (
    raw.parent.purpose === "native_execution" &&
    (raw.effectiveScope === undefined ||
      identityHash(raw.effectiveScope) !== raw.parent.networkScopeHash)
  )
    throw new Error("Native observation effective scope hash changed");
  const observation = NativePlexObservationSchema.parse(input.rawObservation);
  const rawScope =
    observation.parent.purpose === "native_execution"
      ? raw.effectiveScope
      : input.rawScope;
  const scope = NativeStoredScopeSchema.parse(rawScope);
  const lifecycle =
    scope.schemaVersion === 1 ? "published" : scope.lifecycleKind;
  if (lifecycle !== observation.parent.lifecycleKind)
    throw new Error("Native observation lifecycle changed");
  const targets =
    observation.compensationCatalog === undefined
      ? observation.canonicalTargets
      : observation.compensationCatalog
          .flatMap((entry) => entry.targets)
          .sort((a, b) =>
            plexScopeKey(a.scope).localeCompare(plexScopeKey(b.scope)),
          );
  if (targets === undefined)
    throw new Error("Native observation canonical targets missing");
  assertNativeReviewedTargets(scope, targets);
  if (lifecycle === "publication_compensation") {
    assertNativeCompensationCatalog({
      rawScope,
      scopeHash:
        observation.parent.purpose === "native_execution"
          ? observation.parent.networkScopeHash
          : observation.parent.scopeHash,
      observation,
    });
    assertNativeCompensationCatalogNetwork(observation, input.network);
  } else {
    assertPresent(scope, targets, observation.present);
    assertNetworkPresent(scope, observation.present, input.network);
  }
  assertAbsent(scope, observation, input.network);
  return { scope, targets, observation };
}

export function assertNativeReviewedTargets(
  scope: NativeCatalogScopeSnapshot,
  targets: readonly PlexCanonicalTarget[],
) {
  if (
    identityHash(targets.map((value) => value.scope.mediaId).sort()) !==
    identityHash(scope.media.map((value) => value.id).sort())
  )
    throw new Error("Native canonical target coverage changed");
  for (const target of targets) {
    const media = reviewedTargetMedia(scope, target);
    const root =
      media.kind === "movie" ? media : (media.parent?.parent ?? media.parent);
    if (
      root?.id !== target.canonicalRootId ||
      identityHash(
        canonicalReferences({
          ...root,
          kind: media.kind === "movie" ? "movie" : "series",
        }).references,
      ) !== identityHash(target.references)
    )
      throw new Error("Native canonical root references changed");
    if (
      target.kind === "episode" &&
      (target.coordinate.mediaId !== media.id ||
        target.coordinate.seriesId !== root.id ||
        target.coordinate.seasonNumber !== media.seasonNumber ||
        target.coordinate.episodeNumber !== media.episodeNumber ||
        target.coordinate.tmdbEpisodeId !== media.tmdbId)
    )
      throw new Error("Native reviewed episode coordinates changed");
  }
}

function reviewedTargetMedia(
  scope: NativeCatalogScopeSnapshot,
  target: {
    kind: string;
    scope: { mediaId: string; edition: string };
  },
) {
  const media = scope.media.find((value) => value.id === target.scope.mediaId);
  if (media?.kind !== target.kind || target.scope.edition !== "default")
    throw new Error("Native canonical target identity changed");
  return media;
}

function assertPresent(
  scope: NativeCatalogScopeSnapshot,
  targets: readonly PlexCanonicalTarget[],
  present: PlexAssociationV1[],
) {
  const files = nativePlaybackFiles(scope);
  if (
    identityHash(present.map((value) => plexScopeKey(value.scope)).sort()) !==
    identityHash(
      files
        .flatMap((file) =>
          file.mediaIds.map((mediaId) =>
            plexScopeKey({ mediaId, edition: "default" }),
          ),
        )
        .sort(),
    )
  )
    throw new Error("Native Plex playback coverage changed");
  const itemClaims = new Set<string>(),
    parts = new Map<string, string>();
  for (const association of present) {
    const file = files.find(
      (value) => value.assetId === association.group.assetId,
    );
    const target = targets.find(
      (value) => plexScopeKey(value.scope) === plexScopeKey(association.scope),
    );
    if (file === undefined || target === undefined)
      throw new Error("Native Plex playback group missing");
    const coverage = file.mediaIds
      .map((mediaId) => ({ mediaId, edition: "default" }))
      .sort((a, b) => plexScopeKey(a).localeCompare(plexScopeKey(b)));
    const expected = {
      assetId: file.assetId,
      assetVersion: file.assetVersion,
      checksum: file.checksum,
      sizeBytes: file.sizeBytes,
      canonicalPath: file.canonicalPath,
      ownershipEpoch: file.ownershipEpoch,
      canonicalRootId: target.canonicalRootId,
      edition: "default",
      coverage,
      coverageHash: identityHash(coverage),
    };
    if (
      identityHash(association.group) !== identityHash(expected) ||
      association.kind !== target.kind ||
      association.canonicalIdentityHash !== target.canonicalIdentityHash ||
      association.numberingHash !== target.numberingHash ||
      association.editionRootId !== target.canonicalRootId
    )
      throw new Error("Native Plex physical or canonical identity changed");
    assertItemTarget(association, target);
    const itemKey = `${association.access.serverMachineId}/${association.item.ratingKey}`;
    const part = association.item.media[0].parts[0],
      partKey = `${association.access.serverMachineId}/${part.id}`;
    const claim = identityHash({
      group: association.group,
      part,
      access: association.access,
      show:
        association.kind === "episode"
          ? association.hierarchy.show.ratingKey
          : null,
    });
    if (
      itemClaims.has(itemKey) ||
      (parts.has(partKey) && parts.get(partKey) !== claim)
    )
      throw new Error("Native Plex item or Part has conflicting claims");
    itemClaims.add(itemKey);
    parts.set(partKey, claim);
  }
  if (new Set(present.map((value) => value.access.serverMachineId)).size > 1)
    throw new Error("Native Plex playback spans configured servers");
}

function assertItemTarget(
  association: PlexAssociationV1,
  target: PlexCanonicalTarget,
) {
  if (association.kind === "movie") {
    if (!matchesReferences(association.item.guids, target.references))
      throw new Error("Native Plex movie references changed");
    return;
  }
  if (target.kind !== "episode")
    throw new Error("Native Plex episode target changed");
  const { episode, season, show } = association.hierarchy;
  if (
    !matchesReferences(show.guids, target.references) ||
    episode.index !== target.coordinate.episodeNumber ||
    episode.parentIndex !== target.coordinate.seasonNumber ||
    season.index !== target.coordinate.seasonNumber ||
    new Set([episode.ratingKey, season.ratingKey, show.ratingKey]).size !== 3
  )
    throw new Error(
      "Native Plex show references or episode coordinates changed",
    );
}

function tuple(value: {
  mediaId: string;
  ratingKey: string;
  sectionId: string;
  canonicalPath: string;
}) {
  return `${value.mediaId}/${value.ratingKey}/${value.sectionId}/${value.canonicalPath}`;
}

function assertNetworkPresent(
  scope: NativeCatalogScopeSnapshot,
  present: PlexAssociationV1[],
  network: NativePlexNetworkEvidence,
) {
  const actual = present
    .map((value) =>
      tuple({
        mediaId: value.scope.mediaId,
        ratingKey: value.item.ratingKey,
        sectionId: value.access.sectionId,
        canonicalPath: value.group.canonicalPath,
      }),
    )
    .sort();
  if (network.schemaVersion === 1) {
    if (
      identityHash(actual) !==
      identityHash(network.plex.map((value) => tuple(value)).sort())
    )
      throw new Error("Native published paired Network projection changed");
    return;
  }
  if (network.lifecycleKind === "superseded_archive") {
    if (
      identityHash(actual) !==
      identityHash(
        network.plex.currentPlayback
          .flatMap((group) => group.items.map((value) => tuple(value)))
          .sort(),
      )
    )
      throw new Error("Native archive paired Network projection changed");
    const expected = nativePlaybackFiles(scope)
      .map((file) => ({
        assetId: file.assetId,
        assetVersion: file.assetVersion,
        checksum: file.checksum,
        mediaIds: file.mediaIds.toSorted(),
      }))
      .sort((a, b) => a.assetId.localeCompare(b.assetId));
    const groups = network.plex.currentPlayback
      .map(({ items: _items, ...group }) => ({
        ...group,
        mediaIds: group.mediaIds.toSorted(),
      }))
      .sort((a, b) => a.assetId.localeCompare(b.assetId));
    if (identityHash(groups) !== identityHash(expected))
      throw new Error("Native archive Network group changed");
  }
  if (network.lifecycleKind === "committed_quarantine") {
    const expected = scope.files
      .flatMap((file) =>
        file.mediaIds.map((mediaId) => `${mediaId}/${file.canonicalPath}`),
      )
      .sort();
    if (
      identityHash(expected) !==
      identityHash(
        network.plex
          .map((item) => `${item.mediaId}/${item.canonicalPath}`)
          .sort(),
      )
    )
      throw new Error("Native quarantine paired Network coverage changed");
  }
}

function assertAbsent(
  scope: NativeCatalogScopeSnapshot,
  observation: z.infer<typeof NativePlexObservationSchema>,
  network: NativePlexNetworkEvidence,
) {
  const sections = observation.verification.sections;
  const expected = nativeAbsentPaths(scope).flatMap((group) =>
    sections.map((section) => ({
      assetId: group.assetId,
      sectionId: section.sectionId,
      paths: group.paths.toSorted(),
    })),
  );
  const actual = observation.absent.map((value) => ({
    assetId: value.assetId,
    sectionId: value.sectionId,
    paths: value.canonicalPaths.toSorted(),
  }));
  if (
    identityHash(sortedAbsenceGroups(actual)) !==
      identityHash(sortedAbsenceGroups(expected)) ||
    observation.absent.some(
      (value) =>
        value.inventoryHash !==
        observation.verification.passes[1].inventoryHash,
    )
  )
    throw new Error("Native Plex complete absence closure changed");
  for (const item of observation.present)
    if (
      !sections.some(
        (section) =>
          section.sectionId === item.access.sectionId &&
          section.sectionType === item.access.sectionType,
      )
    )
      throw new Error("Native Plex item section was not scanned");
  if (network.schemaVersion === 1) return;
  if (network.lifecycleKind === "committed_quarantine") {
    for (const item of network.plex)
      if (
        !observation.absent.some(
          (absent) =>
            absent.sectionId === item.sectionId &&
            absent.canonicalPaths.includes(item.canonicalPath),
        )
      )
        throw new Error("Native quarantine Network absence section changed");
    return;
  }
  const absent =
    network.lifecycleKind === "superseded_archive"
      ? network.plex.archiveAbsence
      : network.plex.retainedAbsence;
  if (
    identityHash(
      sortedAbsenceGroups(
        absent.map((value) => ({
          assetId: value.assetId,
          sectionId: value.sectionId,
          paths: value.paths.toSorted(),
        })),
      ),
    ) !== identityHash(sortedAbsenceGroups(expected))
  )
    throw new Error("Native paired Network absence closure changed");
}

function absenceGroupKey(value: { assetId: string; sectionId: string }) {
  return `${value.assetId}/${value.sectionId}`;
}

function sortedAbsenceGroups<T extends { assetId: string; sectionId: string }>(
  values: T[],
) {
  return values.sort((a, b) =>
    absenceGroupKey(a).localeCompare(absenceGroupKey(b)),
  );
}
