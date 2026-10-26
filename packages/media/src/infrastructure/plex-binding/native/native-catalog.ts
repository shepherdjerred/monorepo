import { z } from "zod";
import {
  NativeCompensationScopeSchema,
  type NativeCompensationScope,
} from "#shared/native-recovery/compensation.ts";
import {
  NativeCompensationCatalogSchema,
  type NativeCompensationCatalogEntry,
  type NativeCompensationCatalogItem,
} from "#shared/plex-binding/native-catalog.ts";
import type {
  NativePlexObservation,
  NativePlexNetworkEvidence,
} from "#shared/plex-binding/native.ts";
import {
  PlexCanonicalTargetSchema,
  matchesReferences,
  type PlexCanonicalTarget,
} from "#shared/plex-binding/canonical.ts";
import {
  PlexAccessSchema,
  plexScopeKey,
  type PlexAccess,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { PublicationPathSchema } from "#shared/publication-proof/effects.ts";

type Expected = Omit<NativeCompensationCatalogEntry, "items">;
type ProjectionInput = {
  rawScope: unknown;
  scopeHash: string;
  canonicalTargets: readonly PlexCanonicalTarget[];
  access: readonly PlexAccess[];
};

/** Pure immutable parent projection. Fresh producers additionally compare targets with the DB canonical reader. */
export function nativeCompensationCatalogExpected(
  input: ProjectionInput,
): Expected[] {
  if (identityHash(input.rawScope) !== input.scopeHash)
    throw new Error("Compensation catalog raw scope changed");
  const raw = z
    .object({
      entries: z.array(z.object({ entry: z.json(), predecessor: z.json() })),
    })
    .parse(input.rawScope);
  const scope = NativeCompensationScopeSchema.parse(input.rawScope);
  const targets = input.canonicalTargets.map((value) =>
    PlexCanonicalTargetSchema.parse(value),
  );
  assertReviewedTargets(scope, targets);
  const access = input.access.map((value) => PlexAccessSchema.parse(value));
  if (
    new Set(access.map((value) => value.sectionType)).size !== access.length ||
    new Set(access.map((value) => value.serverMachineId)).size !== 1 ||
    new Set(access.map((value) => value.sectionId)).size !== access.length
  )
    throw new Error(
      "Compensation catalog access is not one exact configured server",
    );
  const result = scope.entries
    .map((entry, index): Expected => {
      const source = raw.entries[index],
        predecessor = entry.predecessor;
      if (
        source === undefined ||
        predecessor === null ||
        identityHash(source.entry) !== entry.entryHash
      )
        throw new Error("Compensation catalog original entry changed");
      const kind = entry.entry.libraryKind === "movies" ? "movie" : "show";
      const configured = access.find((value) => value.sectionType === kind);
      const path = PublicationPathSchema.parse({
        root: "library",
        path: entry.entry.libraryPath,
      });
      const root = `/data/${entry.entry.libraryKind}`;
      const canonicalPath = `${root}/${path.path}`;
      const file = scope.files.filter(
        (value) => value.assetId === predecessor.id,
      );
      if (
        configured === undefined ||
        !scope.storageRoots.some((value) => value.rootPath === root) ||
        predecessor.path !== canonicalPath ||
        file.length !== 1 ||
        file[0]?.canonicalPath !== canonicalPath ||
        identityHash(file[0].mediaIds.toSorted()) !==
          identityHash(entry.entry.mediaIds.toSorted()) ||
        !entry.participants.some(
          (value) =>
            value.assetId === predecessor.id &&
            value.role === "video" &&
            value.physical.root === "library" &&
            value.physical.path === path.path &&
            value.physical.state === "present" &&
            value.physical.sha256 === predecessor.checksum,
        )
      )
        throw new Error(
          "Compensation catalog path or complete predecessor coverage changed",
        );
      return {
        entryOperationId: entry.entry.operationId,
        entryHash: entry.entryHash,
        canonicalPath,
        access: configured,
        compatiblePhysicalCandidates: [
          {
            role: "predecessor",
            assetId: predecessor.id,
            sourceHash: identityHash(source.predecessor),
          },
          {
            role: "successor",
            assetId: entry.entry.assetId,
            sourceHash: identityHash(source.entry),
          },
        ],
        targets: targets
          .filter((value) => entry.entry.mediaIds.includes(value.scope.mediaId))
          .sort((a, b) =>
            plexScopeKey(a.scope).localeCompare(plexScopeKey(b.scope)),
          ),
      };
    })
    .sort((a, b) => a.entryOperationId.localeCompare(b.entryOperationId));
  if (
    scope.files.length !== result.length ||
    new Set(result.map((value) => value.canonicalPath)).size !==
      result.length ||
    identityHash(
      [...new Set(result.map((value) => value.access.sectionType))].sort(),
    ) !== identityHash(access.map((value) => value.sectionType).sort())
  )
    throw new Error(
      "Compensation catalog omitted a reviewed group or added unused access",
    );
  NativeCompensationCatalogSchema.parse(
    result.map((value) => ({ ...value, items: [] })),
  );
  return result;
}

function assertReviewedTargets(
  scope: z.infer<typeof NativeCompensationScopeSchema>,
  targets: PlexCanonicalTarget[],
) {
  if (
    identityHash(targets.map((value) => value.scope.mediaId).sort()) !==
    identityHash(scope.media.map((value) => value.id).sort())
  )
    throw new Error("Compensation catalog target coverage changed");
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
      throw new Error("Compensation catalog canonical root references changed");
    if (
      target.kind === "episode" &&
      (target.coordinate.mediaId !== media.id ||
        target.coordinate.seriesId !== root.id ||
        target.coordinate.seasonNumber !== media.seasonNumber ||
        target.coordinate.episodeNumber !== media.episodeNumber ||
        target.coordinate.tmdbEpisodeId !== media.tmdbId)
    )
      throw new Error(
        "Compensation catalog reviewed episode coordinates changed",
      );
  }
}

function reviewedTargetMedia(
  scope: NativeCompensationScope,
  target: {
    kind: string;
    scope: { mediaId: string; edition: string };
  },
) {
  const media = scope.media.find((value) => value.id === target.scope.mediaId);
  if (media?.kind !== target.kind || target.scope.edition !== "default")
    throw new Error("Compensation catalog target identity changed");
  return media;
}

/** No current DB/catalog/config reads: an old paired receipt retains its exact recorded targets. */
export function assertNativeCompensationCatalog(input: {
  rawScope: unknown;
  scopeHash: string;
  observation: NativePlexObservation;
}): void {
  const catalog =
    input.observation.compensationCatalog === undefined
      ? undefined
      : NativeCompensationCatalogSchema.parse(
          input.observation.compensationCatalog,
        );
  if (input.observation.parent.lifecycleKind !== "publication_compensation") {
    if (catalog !== undefined)
      throw new Error("Non-compensation proof contains compensation catalog");
    return;
  }
  if (catalog === undefined || input.observation.present.length > 0)
    throw new Error("Compensation requires catalog-only Plex proof");
  const access = [
    ...new Map(
      catalog.map((value) => [value.access.sectionType, value.access]),
    ).values(),
  ];
  const expected = nativeCompensationCatalogExpected({
    ...input,
    canonicalTargets: catalog.flatMap((value) => value.targets),
    access,
  });
  const scope = NativeCompensationScopeSchema.parse(input.rawScope);
  for (const [index, value] of catalog.entries()) {
    const { items, ...actual } = value;
    if (identityHash(actual) !== identityHash(expected[index]))
      throw new Error(
        "Compensation catalog physical candidate references changed",
      );
    assertCatalogPartSizes(value.entryOperationId, items, scope);
  }
  assertCatalogItemClaims(catalog);
}

function assertCatalogPartSizes(
  entryOperationId: string,
  items: NativeCompensationCatalogItem[],
  scope: NativeCompensationScope,
) {
  const entry = scope.entries.find(
    (candidate) => candidate.entry.operationId === entryOperationId,
  );
  if (entry?.predecessor == null)
    throw new Error("Compensation catalog entry missing");
  for (const item of items) {
    const part = item.item.media[0].parts[0];
    if (
      part.sizeBytes !== undefined &&
      ![entry.predecessor.sizeBytes, entry.entry.sizeBytes].includes(
        part.sizeBytes,
      )
    )
      throw new Error(
        "Compensation catalog Part size matches neither allowed physical candidate",
      );
  }
}

function assertCatalogItemClaims(catalog: NativeCompensationCatalogEntry[]) {
  const itemClaims = new Set<string>(),
    partClaims = new Map<string, string>();
  for (const entry of catalog)
    for (const item of entry.items) {
      const itemKey = `${entry.access.serverMachineId}/${item.item.ratingKey}`;
      const partKey = `${entry.access.serverMachineId}/${item.item.media[0].parts[0].id}`;
      const partClaim = identityHash({
        entryOperationId: entry.entryOperationId,
        part: item.item.media[0].parts[0],
      });
      if (
        itemClaims.has(itemKey) ||
        (partClaims.has(partKey) && partClaims.get(partKey) !== partClaim)
      )
        throw new Error(
          "Compensation catalog item or Part aliases another group",
        );
      itemClaims.add(itemKey);
      partClaims.set(partKey, partClaim);
      assertCatalogItemTarget(entry, item);
    }
}

function assertCatalogItemTarget(
  entry: NativeCompensationCatalogEntry,
  item: NativeCompensationCatalogItem,
) {
  const target = entry.targets.find(
    (value) => value.scope.mediaId === item.scope.mediaId,
  );
  if (
    target === undefined ||
    (item.sectionId !== undefined && item.sectionId !== entry.access.sectionId)
  )
    throw new Error("Compensation catalog actual item section changed");
  if (
    item.kind === "movie" &&
    !matchesReferences(item.item.guids, target.references)
  )
    throw new Error(
      "Compensation catalog actual movie canonical references changed",
    );
  if (item.kind === "episode") assertCatalogEpisode(entry.access, item, target);
}

function assertCatalogEpisode(
  access: PlexAccess,
  item: Extract<NativeCompensationCatalogItem, { kind: "episode" }>,
  target: PlexCanonicalTarget,
) {
  const { episode, season, show } = item.hierarchy;
  if (
    target.kind !== "episode" ||
    episode.ratingKey !== item.item.ratingKey ||
    new Set([episode.ratingKey, season.ratingKey, show.ratingKey]).size !== 3 ||
    !matchesReferences(show.guids, target.references) ||
    episode.parentRatingKey !== season.ratingKey ||
    episode.grandparentRatingKey !== show.ratingKey ||
    season.parentRatingKey !== show.ratingKey ||
    episode.parentIndex !== season.index ||
    episode.parentIndex !== target.coordinate.seasonNumber ||
    episode.index !== target.coordinate.episodeNumber ||
    (season.sectionId !== undefined && season.sectionId !== access.sectionId) ||
    (show.sectionId !== undefined && show.sectionId !== access.sectionId)
  )
    throw new Error(
      "Compensation catalog actual episode/season/show chain changed",
    );
}

/** The new catalog projection and unchanged lifecycle evidence must describe the same observed items. */
export function assertNativeCompensationCatalogNetwork(
  observation: NativePlexObservation,
  network: NativePlexNetworkEvidence,
) {
  if (observation.parent.lifecycleKind !== "publication_compensation") return;
  if (
    !("lifecycleKind" in network) ||
    network.lifecycleKind !== "publication_compensation" ||
    observation.compensationCatalog === undefined
  )
    throw new Error("Compensation paired network lifecycle changed");
  if (
    network.plex.canonicalPaths.length !==
    observation.compensationCatalog.length
  )
    throw new Error("Compensation paired network canonical coverage changed");
  for (const entry of observation.compensationCatalog) {
    const matching = network.plex.canonicalPaths.filter(
      (value) =>
        value.assetId === entry.compatiblePhysicalCandidates[0].assetId,
    );
    const old = matching[0];
    if (
      old === undefined ||
      matching.length !== 1 ||
      old.canonicalPath !== entry.canonicalPath ||
      old.sectionId !== entry.access.sectionId ||
      identityHash(old.mediaIds.toSorted()) !==
        identityHash(
          entry.targets.map((value) => value.scope.mediaId).sort(),
        ) ||
      identityHash(old.items.map((value) => value.ratingKey).sort()) !==
        identityHash(entry.items.map((value) => value.item.ratingKey).sort())
    )
      throw new Error("Compensation paired network item projection changed");
  }
}
