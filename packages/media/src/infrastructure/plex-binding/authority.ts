import { Prisma } from "#generated/prisma/client.ts";
import {
  PlexBindingExpectedSchema,
  type PlexBindingExpected,
  type PlexBindingLockScope,
  type PlexPublicationParent,
} from "#shared/plex-binding/expected.ts";
import {
  PlexAccessSchema,
  type PlexAccess,
  type PlexBindingFreshness,
  type PlexBindingSnapshot,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  lockCanonicalMedia,
  lockExistingDefaultTargets,
} from "#infrastructure/editions/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import {
  lockRuntimeAuthority,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { compensationRecord } from "#infrastructure/native-compensation/records.ts";
import {
  assertCompensationPublicationLockScope,
  type CompensationPublicationPhase,
} from "#infrastructure/native-compensation/publication/phase.ts";
import { readPlexCanonicalTargets } from "./canonical.ts";
import {
  readPlexGroupUnion,
  readPlexIdentityCohort,
  readPlexPublicationAssetLocks,
} from "./groups.ts";
import { readPlexPointers } from "./records.ts";
import { readCurrentPlexBindings, readPlexDefinition } from "./read.ts";
import { PlexBindingProtection } from "./errors.ts";
import { bindPlexTransactionDeadline } from "./freshness.ts";
import { assertPlexPublicationParents } from "./parents.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function capturePlexBindingExpected(
  tx: Prisma.TransactionClient,
  input: {
    mediaIds: readonly string[];
    parents: readonly PlexPublicationParent[];
    access: readonly PlexAccess[];
  },
): Promise<PlexBindingExpected> {
  const union = await readPlexGroupUnion(tx, input.mediaIds);
  const access = input.access.map((value) => PlexAccessSchema.parse(value));
  if (
    union.oldServerMachineIds.some(
      (server) => server !== access[0]?.serverMachineId,
    )
  )
    throw new PlexBindingProtection("wrong_server");
  const scopes = union.mediaIds.map((mediaId) => ({
    mediaId,
    edition: "default" as const,
  }));
  const canonical = await readPlexCanonicalTargets(tx, scopes);
  const requiredKinds = [
    ...new Set(
      canonical.map((value) => (value.kind === "movie" ? "movie" : "show")),
    ),
  ].sort();
  if (
    identityHash(requiredKinds) !==
    identityHash(access.map((value) => value.sectionType))
  )
    throw new PlexBindingProtection("wrong_section");
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const intents = await tx.mediaIntent.findMany({
    where: { OR: scopes },
    include: { media: true },
    orderBy: { mediaId: "asc" },
  });
  if (intents.length !== scopes.length)
    throw new PlexBindingProtection("scope_changed");
  const byId = new Map(canonical.map((row) => [row.scope.mediaId, row]));
  const targets = [];
  const definitions = new Map<
    string,
    Awaited<ReturnType<typeof readPlexDefinition>>
  >();
  for (const intent of intents) {
    const identity = byId.get(intent.mediaId);
    if (intent.editionRootId !== identity?.canonicalRootId)
      throw new PlexBindingProtection("scope_changed");
    const definitionKey = `${identity.canonicalRootId}/${identity.scope.edition}`;
    let definition = definitions.get(definitionKey);
    if (definition === undefined) {
      definition = await readPlexDefinition(
        tx,
        identity.scope,
        identity.canonicalRootId,
      );
      definitions.set(definitionKey, definition);
    }
    targets.push({
      scope: identity.scope,
      editionRootId: identity.canonicalRootId,
      mediaVersion: intent.media.version,
      intentVersion: intent.version,
      generation: intent.generation,
      automationEpoch: intent.automationEpoch,
      definition,
      canonicalIdentityHash: identity.canonicalIdentityHash,
      numberingHash: identity.numberingHash,
    });
  }
  const pointers = await readPlexPointers(tx, scopes);
  const previous = pointers.map((pointer) => pointer.expected);
  return PlexBindingExpectedSchema.parse({
    schemaVersion: 1,
    recoveryEpoch: runtime.recoveryEpoch,
    access,
    targets,
    previous,
    oldGroups: union.oldGroups,
    newGroups: union.newGroups,
    parents: input.parents,
  });
}

export async function preparePlexBindingLockScope(
  tx: Prisma.TransactionClient,
  rawExpected: PlexBindingExpected,
): Promise<PlexBindingLockScope> {
  const expected = PlexBindingExpectedSchema.parse(rawExpected);
  const server = expected.access[0];
  if (server === undefined) throw new Error("Plex expected access missing");
  const union = await readPlexGroupUnion(
    tx,
    expected.targets.map((row) => row.scope.mediaId),
  );
  if (
    union.oldServerMachineIds.some((value) => value !== server.serverMachineId)
  )
    throw new PlexBindingProtection("wrong_server");
  if (
    identityHash(union.oldGroups) !== identityHash(expected.oldGroups) ||
    identityHash(union.newGroups) !== identityHash(expected.newGroups)
  )
    throw new PlexBindingProtection("scope_changed");
  return {
    expected,
    mediaIds: union.mediaIds,
    canonicalRootIds: [
      ...new Set(expected.targets.map((row) => row.editionRootId)),
    ].sort(),
    assetIds: await readPlexPublicationAssetLocks(tx, {
      groups: union.newGroups,
      oldGroups: union.oldGroups,
      mediaIds: union.mediaIds,
      parents: expected.parents,
    }),
    userIds: await readPlexIdentityCohort(tx, union.mediaIds, expected.parents),
    serverMachineId: server.serverMachineId,
  };
}

export type PlexCompensationPurposeLock = {
  kind: "compensation";
  continuationId: string;
  /** The existing exact compensated-publication guard, never an arbitrary root expansion. */
  lockAndAssert: (budget: PublicationAuthorityReadBudget) => Promise<void>;
};

function assertCompensationPhaseAdapter(
  tx: Prisma.TransactionClient,
  scope: PlexBindingLockScope,
  phase: CompensationPublicationPhase,
  options: {
    purpose?: PlexCompensationPurposeLock | undefined;
    budget: PublicationAuthorityReadBudget;
  },
) {
  if (options.purpose !== undefined)
    throw new Error(
      "Compensation phase cannot combine an independent purpose callback",
    );
  assertCompensationPublicationLockScope(tx, phase, scope, options.budget);
}

async function assertCompensationLockClosure(
  tx: Prisma.TransactionClient,
  scope: PlexBindingLockScope,
  purpose: PlexCompensationPurposeLock | undefined,
  budget: PublicationAuthorityReadBudget,
) {
  const parents = scope.expected.parents.filter(
    (parent) => parent.kind === "compensation",
  );
  if (purpose === undefined && parents.length === 0) return;
  const parent = parents[0];
  if (parent === undefined || purpose === undefined)
    throw new Error(
      "Plex compensation requires its exact publication lock adapter",
    );
  if (parents.length !== 1 || purpose.continuationId !== parent.continuationId)
    throw new Error(
      "Plex compensation requires its exact publication lock adapter",
    );
  const record = await compensationRecord(tx, parent.continuationId, budget);
  const ids = [...new Set(record.descriptor.scope.intent.mediaIds)].sort();
  const assets = new Set(
    record.descriptor.scope.intent.entries.flatMap(({ entry }) => [
      entry.assetId,
      ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
    ]),
  );
  if (
    identityHash(ids) !== identityHash(scope.mediaIds) ||
    scope.assetIds.some((id) => !assets.has(id)) ||
    !scope.userIds.includes(record.row.receipt.actorId) ||
    record.row.receiptId !== parent.receiptId ||
    record.row.descriptorHash !== parent.descriptorHash ||
    record.row.publicationCoordinatorOperationId !== parent.operationId
  )
    throw new PlexBindingProtection("scope_changed");
}

/** Complete roots, runtime UPDATE and identities precede the native guard's cleanup/assets; server is last. */
export async function lockPlexBindingScope(
  tx: Prisma.TransactionClient,
  scope: PlexBindingLockScope,
  freshness: PlexBindingFreshness,
  options: {
    purpose?: PlexCompensationPurposeLock | undefined;
    budget?: PublicationAuthorityReadBudget;
    compensationPhase?: CompensationPublicationPhase | undefined;
  } = {},
): Promise<void> {
  const {
    purpose,
    budget = new PublicationAuthorityReadBudget(),
    compensationPhase,
  } = options;
  freshness.assertActive();
  if (compensationPhase === undefined)
    await assertCompensationLockClosure(tx, scope, purpose, budget);
  else
    assertCompensationPhaseAdapter(tx, scope, compensationPhase, {
      purpose,
      budget,
    });
  freshness.assertActive();
  await lockCanonicalMedia(tx, scope.mediaIds);
  freshness.assertActive();
  await lockExistingDefaultTargets(tx, scope.mediaIds);
  await lockEffectiveRequests(tx, scope.mediaIds);
  freshness.assertActive();
  if (purpose === undefined && compensationPhase === undefined) {
    if (!(await lockRuntimeAuthority(tx, scope.expected.recoveryEpoch)))
      throw new PlexBindingProtection("ownership_changed");
  } else {
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id='singleton' FOR UPDATE`;
    const runtime = await runtimeAuthority(tx);
    if (!runtime.active || runtime.epoch !== scope.expected.recoveryEpoch)
      throw new PlexBindingProtection("ownership_changed");
  }
  const current = await preparePlexBindingLockScope(tx, scope.expected);
  freshness.assertActive();
  if (identityHash(current) !== identityHash(scope))
    throw new PlexBindingProtection("scope_changed");
  if (compensationPhase !== undefined)
    assertCompensationPublicationLockScope(
      tx,
      compensationPhase,
      current,
      budget,
    );
  if (scope.userIds.length > 0) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(scope.userIds)}) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(scope.userIds)}) ORDER BY "userId" FOR SHARE`,
    );
  }
  freshness.assertActive();
  if (purpose !== undefined) {
    await assertCompensationLockClosure(tx, scope, purpose, budget);
    freshness.assertActive();
    await purpose.lockAndAssert(budget);
    freshness.assertActive();
  }
  if (scope.assetIds.length > 0) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "UpgradeCleanup" WHERE "assetId" IN (${Prisma.join(scope.assetIds)}) OR "successorAssetId" IN (${Prisma.join(scope.assetIds)}) ORDER BY id FOR UPDATE`,
    );
    freshness.assertActive();
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(scope.assetIds)}) ORDER BY id FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(scope.assetIds)}) ORDER BY "assetId","mediaId" FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "SubtitleAsset" WHERE "assetId" IN (${Prisma.join(scope.assetIds)}) ORDER BY id FOR SHARE`,
    );
  }
  freshness.assertActive();
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + scope.serverMachineId},0))::text`;
  await bindPlexTransactionDeadline(tx, freshness);
  await assertPlexBindingExpected(tx, scope.expected, freshness, {
    access: scope.expected.access,
    budget,
    compensationPhase,
  });
}

export async function assertPlexBindingExpected(
  tx: Prisma.TransactionClient,
  expected: PlexBindingExpected,
  freshness: PlexBindingFreshness,
  options: {
    access: readonly PlexAccess[];
    budget?: PublicationAuthorityReadBudget;
    compensationPhase?: CompensationPublicationPhase | undefined;
  },
): Promise<void> {
  const {
    access,
    budget = new PublicationAuthorityReadBudget(),
    compensationPhase,
  } = options;
  freshness.assertActive();
  if (identityHash(access) !== identityHash(expected.access))
    throw new PlexBindingProtection("wrong_section");
  const current = await capturePlexBindingExpected(tx, {
    mediaIds: expected.targets.map((row) => row.scope.mediaId),
    parents: expected.parents,
    access,
  });
  freshness.assertActive();
  if (identityHash(current) !== identityHash(expected))
    throw new PlexBindingProtection("scope_changed");
  await assertPlexPublicationParents(tx, expected, freshness, {
    budget,
    compensationPhase,
  });
  freshness.assertActive();
}

export async function assertPlexBindingSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    bindings: readonly PlexBindingSnapshot[];
    access: readonly PlexAccess[];
  },
  freshness: PlexBindingFreshness,
): Promise<void> {
  const pointers = await readPlexPointers(
    tx,
    input.bindings.map((binding) => binding.scope),
  );
  const reads = input.bindings.map((binding, index) => {
    const pointer = pointers[index];
    if (pointer === undefined)
      throw new Error("Plex snapshot read omitted a scope");
    if (
      pointer.current === null ||
      identityHash(pointer.current.snapshot) !== identityHash(binding)
    )
      throw new PlexBindingProtection("binding_changed");
    const access = input.access.find(
      (value) =>
        value.sectionType === pointer.current.association.access.sectionType,
    );
    if (access === undefined) throw new PlexBindingProtection("wrong_section");
    return {
      scope: binding.scope,
      assetId: pointer.current.association.group.assetId,
      access,
    };
  });
  const currentReads = await readCurrentPlexBindings(tx, reads);
  freshness.assertActive();
  for (const current of currentReads) {
    if (current.status !== "current")
      throw new PlexBindingProtection(current.reason);
  }
}
