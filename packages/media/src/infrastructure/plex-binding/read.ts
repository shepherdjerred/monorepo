import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type {
  PlexAccess,
  PlexAssociation,
  PlexBindingRead,
  PlexBindingScope,
  LegacyPlexDisplay,
} from "#shared/plex-binding/contract.ts";
import type { DefaultEditionScope } from "#shared/editions/scope.ts";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";
import {
  PlexDefinitionRefSchema,
  PlexPhysicalGroupSchema,
  plexScopeKey,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { recordsAuthorized } from "#infrastructure/handoff/authority.ts";
import { readPlexCanonicalTargets } from "./canonical.ts";
import { readPlexPointers } from "./records.ts";
import { PlexBindingProtection } from "./errors.ts";
import {
  matchesMovieDefinition,
  movieDefinitionRef,
} from "#infrastructure/movie-editions/definition.ts";
import { compensationPlayback } from "#infrastructure/native-compensation/playback.ts";
import type { PlexCanonicalTarget } from "#shared/plex-binding/canonical.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type BindingInput = {
  scope: PlexBindingScope;
  assetId: string;
  access: PlexAccess;
};
type LegacyInput = {
  scope: DefaultEditionScope;
  assetId: string;
  access: PlexAccess;
};
type CurrentReadState = {
  canonicalByKey: Map<string, PlexCanonicalTarget>;
  groups: Map<string, string>;
  definitions: Map<string, Awaited<ReturnType<typeof readPlexDefinition>>>;
};

function defaultEdition(scope: { edition: string }) {
  return scope.edition === "default";
}

export async function readPlexDefinition(
  tx: Prisma.TransactionClient,
  scope: PlexBindingScope,
  rootId: string,
) {
  const row = await tx.mediaEditionDefinition.findUniqueOrThrow({
    where: { rootMediaId_key: { rootMediaId: rootId, key: scope.edition } },
  });
  const root = await tx.mediaItem.findUniqueOrThrow({
    where: { id: rootId },
    select: { kind: true },
  });
  if (
    root.kind === "movie" &&
    !matchesMovieDefinition(
      row,
      movieDefinitionRef(rootId, scope.edition).definition,
    )
  )
    throw new PlexBindingProtection("binding_changed");
  const identity = {
    rootMediaId: row.rootMediaId,
    key: row.key,
    policy: row.policy,
    pathLabel: row.pathLabel,
    plexLabel: row.plexLabel,
    definitionVersion: row.definitionVersion,
  };
  return PlexDefinitionRefSchema.parse({
    rootMediaId: rootId,
    key: scope.edition,
    definitionVersion: row.definitionVersion,
    definitionHash: identityHash(identity),
  });
}

export async function readPlexPhysicalGroup(
  tx: Prisma.TransactionClient,
  assetId: string,
) {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: {
      coverage: { where: { current: true }, orderBy: { mediaId: "asc" } },
    },
  });
  if (
    !asset.owned ||
    asset.checksum === null ||
    asset.editionRootId === null ||
    asset.coverage.length === 0
  )
    throw new PlexBindingProtection("ownership_changed");
  const coverage = asset.coverage.map((row) => ({
    mediaId: row.mediaId,
    edition: row.edition,
  }));
  const group = PlexPhysicalGroupSchema.parse({
    assetId,
    assetVersion: asset.version,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes.toString(),
    canonicalPath: asset.path,
    ownershipEpoch: asset.ownershipEpoch,
    canonicalRootId: asset.editionRootId,
    edition: asset.edition,
    coverage,
    coverageHash: identityHash(coverage),
  });
  return { asset, group };
}

async function assertServingGroup(
  tx: Prisma.TransactionClient,
  association: PlexAssociation,
  assetId: string,
) {
  const { asset, group } = await readPlexPhysicalGroup(tx, assetId);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    asset.state !== "published" ||
    association.group.assetId !== assetId ||
    identityHash(group) !== identityHash(association.group) ||
    !(association.schemaVersion === 1
      ? await recordsAuthorized(tx, {
          epoch: runtime.recoveryEpoch,
          mediaIds: group.coverage.map((row) => row.mediaId),
          assetIds: [assetId],
        })
      : asset.ownershipEpoch === runtime.recoveryEpoch &&
        (await tx.mediaIntent.count({
          where: {
            mediaId: association.scope.mediaId,
            edition: association.scope.edition,
            editionRootId: association.editionRootId,
            automationEpoch: runtime.recoveryEpoch,
          },
        })) === 1)
  )
    throw new PlexBindingProtection("ownership_changed");
  if (
    await tx.nativePublicationCompensationContinuation.count({
      where: {
        fenceRelease: { equals: Prisma.DbNull },
        OR: [
          { assetIds: { has: assetId } },
          { mediaIds: { hasSome: group.coverage.map((row) => row.mediaId) } },
        ],
      },
    })
  )
    throw new PlexBindingProtection("compensation_fence_active");
  const targets = await tx.mediaIntent.findMany({
    where: { OR: group.coverage },
    select: { mediaId: true, edition: true, editionRootId: true },
  });
  if (
    targets.length !== group.coverage.length ||
    targets.some((target) => target.editionRootId !== group.canonicalRootId)
  )
    throw new PlexBindingProtection("scope_changed");
}

/** Current-serving authority is deliberately independent of immutable historical ACK. */
export async function readCurrentPlexBinding(
  tx: Prisma.TransactionClient,
  input: {
    scope: PlexBindingScope;
    assetId: string;
    access: PlexAccess;
  },
  budget?: PublicationAuthorityReadBudget,
): Promise<PlexBindingRead> {
  const results = await readCurrentPlexBindings(tx, [input], budget);
  const result = results[0];
  if (result === undefined)
    throw new Error("Plex current read omitted its scope");
  return result;
}

/** Legacy links are labelled display only and cannot replace a changed or cleared binding. */
export async function readLegacyDefaultPlexDisplay(
  tx: Prisma.TransactionClient,
  input: LegacyInput,
): Promise<LegacyPlexDisplay> {
  if (!defaultEdition(input.scope))
    return { status: "protected", reason: "missing_binding" };
  try {
    const pointers = await readPlexPointers(tx, [input.scope]);
    const pointer = pointers[0];
    if (pointer === undefined)
      throw new Error("Legacy Plex display omitted its pointer scope");
    if (pointer.expected.revision !== 0 || pointer.current !== null)
      return { status: "protected", reason: "binding_changed" };
    const { asset, group } = await readPlexPhysicalGroup(tx, input.assetId);
    const targets = await readPlexCanonicalTargets(tx, [input.scope]);
    const canonical = targets[0];
    if (canonical === undefined)
      throw new Error("Legacy Plex display omitted its canonical scope");
    if (
      asset.state !== "published" ||
      group.edition !== "default" ||
      group.canonicalRootId !== canonical.canonicalRootId ||
      !group.coverage.some(
        (scope) => plexScopeKey(scope) === plexScopeKey(input.scope),
      )
    )
      return { status: "protected", reason: "ownership_changed" };
    if (
      input.access.sectionType !==
      (canonical.kind === "movie" ? "movie" : "show")
    )
      return { status: "protected", reason: "wrong_section" };
    const current = await tx.assetCoverage.findMany({
      where: { ...input.scope, current: true },
      select: { assetId: true },
    });
    if (current.length !== 1 || current[0]?.assetId !== asset.id)
      return { status: "protected", reason: "scope_changed" };
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      !(await recordsAuthorized(tx, {
        epoch: runtime.recoveryEpoch,
        mediaIds: group.coverage.map((scope) => scope.mediaId),
        assetIds: [asset.id],
      }))
    )
      return { status: "protected", reason: "ownership_changed" };
    return await legacyLinkDisplay(tx, { input, asset, runtime });
  } catch (error) {
    if (error instanceof PlexBindingProtection)
      return { status: "protected", reason: error.reason };
    throw error;
  }
}

async function legacyLinkDisplay(
  tx: Prisma.TransactionClient,
  state: {
    input: LegacyInput;
    asset: { plexPublishedAt: Date | null };
    runtime: { recoveryEpoch: number };
  },
): Promise<LegacyPlexDisplay> {
  const { input, asset, runtime } = state;
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.scope.mediaId },
  });
  const binding = z
    .object({
      plexRatingKey: PlexDecimalIdSchema,
      plexSectionId: PlexDecimalIdSchema,
    })
    .safeParse(media.externalIds);
  if (!binding.success)
    return { status: "protected", reason: "missing_binding" };
  if (binding.data.plexSectionId !== input.access.sectionId)
    return { status: "protected", reason: "wrong_section" };
  const matches = await tx.mediaItem.count({
    where: {
      kind: media.kind,
      AND: [
        {
          externalIds: {
            path: ["plexRatingKey"],
            equals: binding.data.plexRatingKey,
          },
        },
        {
          externalIds: {
            path: ["plexSectionId"],
            equals: binding.data.plexSectionId,
          },
        },
      ],
    },
  });
  if (matches !== 1) return { status: "protected", reason: "ambiguous_item" };
  const playback = await compensationPlayback(tx, {
    mediaId: media.id,
    recoveryEpoch: runtime.recoveryEpoch,
    serverMachineId: input.access.serverMachineId,
    externalIds: media.externalIds,
  });
  if (playback.state === "protected")
    return { status: "protected", reason: "compensation_fence_active" };
  if (
    playback.state === "ordinary" &&
    (asset.plexPublishedAt === null ||
      asset.plexPublishedAt.getTime() > Date.now())
  )
    return { status: "protected", reason: "missing_binding" };
  return {
    status: "legacy_association_unverified",
    ratingKey: binding.data.plexRatingKey,
    sectionId: binding.data.plexSectionId,
  };
}

/** Complete-cohort reads share each physical and canonical proof within this transaction only. */
export async function readCurrentPlexBindings(
  tx: Prisma.TransactionClient,
  inputs: readonly {
    scope: PlexBindingScope;
    assetId: string;
    access: PlexAccess;
  }[],
  budget?: PublicationAuthorityReadBudget,
): Promise<PlexBindingRead[]> {
  if (inputs.length === 0) return [];
  if (
    inputs.length > 10_000 ||
    new Set(inputs.map((input) => plexScopeKey(input.scope))).size !==
      inputs.length
  )
    throw new Error("Plex read cohort must be complete and distinct");
  const sorted = [...inputs].sort((a, b) =>
    plexScopeKey(a.scope).localeCompare(plexScopeKey(b.scope)),
  );
  try {
    const pointers = await readPlexPointers(
      tx,
      sorted.map((input) => input.scope),
      budget,
    );
    const canonical = await readPlexCanonicalTargets(
      tx,
      sorted.map((input) => input.scope),
    );
    const canonicalByKey = new Map(
      canonical.map((value) => [plexScopeKey(value.scope), value]),
    );
    const groups = new Map<string, string>();
    const definitions = new Map<
      string,
      Awaited<ReturnType<typeof readPlexDefinition>>
    >();
    const results = new Map<string, PlexBindingRead>();
    const state = { canonicalByKey, groups, definitions };
    for (const [index, input] of sorted.entries()) {
      results.set(
        plexScopeKey(input.scope),
        await readCurrentBindingMember(tx, input, pointers[index], state),
      );
    }
    return inputs.map((input) => {
      const result = results.get(plexScopeKey(input.scope));
      if (result === undefined)
        throw new Error("Plex read cohort result missing");
      return result;
    });
  } catch (error) {
    if (error instanceof PlexBindingProtection)
      return inputs.map(() => ({ status: "protected", reason: error.reason }));
    throw error;
  }
}

async function readCurrentBindingMember(
  tx: Prisma.TransactionClient,
  input: BindingInput,
  pointer: Awaited<ReturnType<typeof readPlexPointers>>[number] | undefined,
  state: CurrentReadState,
): Promise<PlexBindingRead> {
  if (pointer === undefined)
    throw new Error("Plex pointer read omitted a cohort member");
  if (pointer.current === null) {
    return {
      status: "protected",
      reason: "missing_binding",
    };
  }
  const { association, snapshot } = pointer.current;
  if (association.access.serverMachineId !== input.access.serverMachineId)
    throw new PlexBindingProtection("wrong_server");
  if (
    association.access.sectionId !== input.access.sectionId ||
    association.access.sectionType !== input.access.sectionType
  )
    throw new PlexBindingProtection("wrong_section");
  const groupHash = identityHash(association.group);
  const validated = state.groups.get(input.assetId);
  if (validated === undefined) {
    await assertServingGroup(tx, association, input.assetId);
    state.groups.set(input.assetId, groupHash);
  } else if (validated !== groupHash)
    throw new Error("Plex read cohort has inconsistent physical membership");
  await assertCurrentCanonical(tx, input, association, state);
  return {
    status: "current",
    purpose: "current_serving",
    snapshot,
    association,
  };
}

async function assertCurrentCanonical(
  tx: Prisma.TransactionClient,
  input: BindingInput,
  association: PlexAssociation,
  state: CurrentReadState,
) {
  const target = state.canonicalByKey.get(plexScopeKey(input.scope));
  if (
    target?.canonicalRootId !== association.editionRootId ||
    target.canonicalIdentityHash !== association.canonicalIdentityHash ||
    target.numberingHash !== association.numberingHash
  )
    throw new PlexBindingProtection("metadata_changed");
  const definitionKey = `${target.canonicalRootId}/${input.scope.edition}`;
  let definition = state.definitions.get(definitionKey);
  if (definition === undefined) {
    definition = await readPlexDefinition(
      tx,
      input.scope,
      target.canonicalRootId,
    );
    state.definitions.set(definitionKey, definition);
  }
  if (identityHash(definition) !== identityHash(association.definition))
    throw new PlexBindingProtection("binding_changed");
  if (
    association.kind === "episode" &&
    target.kind === "episode" &&
    (association.hierarchy.episode.index !== target.coordinate.episodeNumber ||
      association.hierarchy.episode.parentIndex !==
        target.coordinate.seasonNumber)
  )
    throw new PlexBindingProtection("metadata_changed");
  if (
    !association.group.coverage.some(
      (scope) => plexScopeKey(scope) === plexScopeKey(input.scope),
    )
  )
    throw new Error("Plex evidence omitted its own member");
}
