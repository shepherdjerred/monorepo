import {
  NativePlexObservationSchema,
  type NativePlexProofParent,
} from "#shared/plex-binding/native.ts";
import {
  PlexAssociationV1Schema,
  plexScopeKey,
} from "#shared/plex-binding/contract.ts";
import { NativeCompensationCatalogItemSchema } from "#shared/plex-binding/native-catalog.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import {
  readSections,
  scanInventory,
} from "#automation/publication/association/scan.ts";
import { associationHash } from "#automation/publication/association/projection.ts";
import {
  plexRead,
  assertAssociationActive,
} from "#automation/publication/association/io.ts";
import type { AssociationContext } from "#automation/publication/association/types.ts";
import { selectNativeCatalog } from "./selection.ts";
import type { NativeCatalogScope, NativeScope } from "./scope.ts";
import { MediaError } from "#application/errors.ts";

function projectSelection(
  scope: NativeCatalogScope,
  selected: Awaited<ReturnType<typeof selectNativeCatalog>>,
) {
  const present = selected
    .flatMap(({ group, items }) => {
      const physical = scope.physical.get(group.canonicalPath);
      if (physical === undefined) return [];
      return items.map((item) => {
        const definition = scope.definitions.get(
          plexScopeKey(item.target.scope),
        );
        if (definition === undefined)
          throw new Error("Native reviewed default definition missing");
        const common = {
          schemaVersion: 1,
          scope: item.target.scope,
          editionRootId: item.target.canonicalRootId,
          definition,
          canonicalIdentityHash: item.target.canonicalIdentityHash,
          numberingHash: item.target.numberingHash,
          group: physical,
          access: group.access,
          item: item.identity,
        };
        return PlexAssociationV1Schema.parse(
          item.target.kind === "movie"
            ? { ...common, kind: "movie" }
            : { ...common, kind: "episode", hierarchy: item.hierarchy },
        );
      });
    })
    .sort((a, b) => plexScopeKey(a.scope).localeCompare(plexScopeKey(b.scope)));
  const compensationCatalog = scope.compensation?.map((descriptor) => {
    const found = selected.find(
      (value) => value.group.canonicalPath === descriptor.canonicalPath,
    );
    if (found === undefined)
      throw new Error("Native compensation catalog omitted an entry");
    return {
      ...descriptor,
      items: found.items.map((value) =>
        NativeCompensationCatalogItemSchema.parse({
          kind: value.target.kind,
          scope: value.target.scope,
          item: value.identity,
          ...(value.sectionId === undefined
            ? {}
            : { sectionId: value.sectionId }),
          ...(value.hierarchy === null ? {} : { hierarchy: value.hierarchy }),
        }),
      ),
    };
  });
  return {
    present,
    ...(compensationCatalog === undefined ? {} : { compensationCatalog }),
  };
}

/** Complete catalog passes finish before the caller's final session observation. */
export async function scanNativePlex(
  context: AssociationContext,
  scope: NativeCatalogScope,
) {
  const serverMachineId = scope.access[0]?.serverMachineId;
  if (
    serverMachineId === undefined ||
    scope.access.some((value) => value.serverMachineId !== serverMachineId)
  )
    throw new Error("Native access must name one configured server");
  const sectionScope = { access: scope.access, serverMachineId };
  const sections = await readSections(context, sectionScope);
  const absent = new Set(scope.absent.flatMap((group) => group.paths));
  const pass = async () => {
    const inventory = await scanInventory(context, sections);
    if (
      inventory.inventory.some((row) =>
        row.projection.media.some((media) =>
          media.parts.some(
            (part) =>
              absent.has(part.file) || part.file.includes("/.media-control/"),
          ),
        ),
      )
    )
      throw new PlexBindingProtection("metadata_changed");
    const selected = await selectNativeCatalog(
      context,
      scope.groups,
      inventory.inventory,
    );
    const projection = projectSelection(scope, selected);
    return {
      ...inventory,
      selected,
      projection,
      facts: {
        itemCount: inventory.inventory.length,
        inventoryHash: inventory.inventoryHash,
        selectedHash: associationHash(projection),
      },
    };
  };
  const first = await pass();
  const second = await pass();
  if (associationHash(first.facts) !== associationHash(second.facts))
    throw new PlexBindingProtection("metadata_changed");
  if (
    associationHash(await readSections(context, sectionScope)) !==
    associationHash(sections)
  )
    throw new PlexBindingProtection("wrong_section");
  assertAssociationActive(context);
  return {
    ...second,
    sections,
    completedAt: new Date().toISOString(),
    passes: [first.facts, second.facts] as const,
  };
}

/** Last external IO: unknown, canonical, selected-key and every control-path session protects. */
export async function finishNativePlex(
  context: AssociationContext,
  input: {
    scope: NativeScope | Pick<NativeScope, "media">;
    catalog: NativeCatalogScope;
    parent: NativePlexProofParent;
    scanned: Awaited<ReturnType<typeof scanNativePlex>>;
    observed: { wall: number; monotonic: number };
  },
) {
  const { scope, catalog, parent, scanned } = input;
  const keys = new Set(
    scanned.selected.flatMap((group) =>
      group.items.map((item) => item.identity.ratingKey),
    ),
  );
  for (const media of scope.media) {
    const ids = media.externalIds;
    if (
      ids !== null &&
      typeof ids === "object" &&
      !Array.isArray(ids) &&
      typeof ids["plexRatingKey"] === "string"
    )
      keys.add(ids["plexRatingKey"]);
  }
  const paths = new Set(catalog.paths);
  const sessions = await plexRead(
    context,
    () => context.plex.activeSessions(context.execution.signal),
    "inaccessible",
  );
  const checkedAt = new Date().toISOString();
  if (
    sessions.some(
      (item) =>
        keys.has(item.ratingKey) ||
        item.Media === undefined ||
        item.Media.length === 0 ||
        item.Media.some(
          (media) =>
            media.Part.length === 0 ||
            media.Part.some(
              (part) =>
                paths.has(part.file) || part.file.includes("/.media-control/"),
            ),
        ),
    )
  )
    throw new MediaError(
      "native_plex_playback_active_or_unknown",
      "Native Plex playback is active or unknown",
      409,
    );
  const playback = {
    state: "clear" as const,
    checkedAt,
    scopeHash: associationHash({
      paths: [...paths].sort(),
      keys: [...keys].sort(),
    }),
  };
  const expiresAt = new Date(context.freshness.expiresAtMs).toISOString();
  const completedAt = new Date().toISOString();
  if (parent.purpose === "native_execution" && !("files" in scope))
    throw new Error(
      "Native execution observation omitted its captured effective scope",
    );
  const observation = NativePlexObservationSchema.parse({
    purpose: parent.purpose,
    parent,
    ...scanned.projection,
    ...(parent.lifecycleKind === "publication_compensation"
      ? {}
      : { canonicalTargets: catalog.canonicalTargets }),
    ...(parent.purpose === "native_execution" ? { effectiveScope: scope } : {}),
    absent: catalog.absent.flatMap((group) =>
      scanned.sections.map((section) => ({
        assetId: group.assetId,
        sectionId: section.sectionId,
        canonicalPaths: group.paths,
        inventoryHash: scanned.inventoryHash,
      })),
    ),
    verification: {
      startedAt: new Date(input.observed.wall).toISOString(),
      completedAt: scanned.completedAt,
      expiresAt,
      sections: scanned.sections,
      passes: scanned.passes,
    },
  });
  assertAssociationActive(context);
  return {
    observation,
    playback,
    timing: {
      startedAt: observation.verification.startedAt,
      completedAt,
      sessionsCheckedAt: checkedAt,
      expiresAt,
    },
  };
}
