import { Prisma } from "#generated/prisma/client.ts";
import {
  LibraryPlexExpectedV2Schema,
  type LibraryPlexExpectedV2,
} from "#shared/plex-binding/library.ts";
import {
  PlexPhysicalGroupSchema,
  plexScopeKey,
  type PlexAccess,
  type PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import type { LibraryPlexBindingInputV1 } from "#shared/plex-binding/activities.ts";
import type { loadLibraryAssetParentV1 } from "#infrastructure/handoff/library-asset.ts";
import type { PlexCanonicalTarget } from "#shared/plex-binding/canonical.ts";
import {
  lockRuntimeAuthority,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { lockCanonicalMedia } from "#infrastructure/editions/locks.ts";
import {
  readPlexPhysicalGroup,
  readPlexDefinition,
} from "#infrastructure/plex-binding/read.ts";
import { readPlexPointers } from "#infrastructure/plex-binding/records.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  assertLibraryCanonicalBirth,
  type LibraryCanonicalBirth,
} from "./canonical.ts";

export type LibraryPlexParent = Awaited<
  ReturnType<typeof loadLibraryAssetParentV1>
>;

export function libraryPlexPhysicalGroup(parent: LibraryPlexParent) {
  const asset = parent.asset;
  const coverage = asset.coverage
    .map(({ mediaId, edition }) => ({ mediaId, edition }))
    .sort((a, b) => plexScopeKey(a).localeCompare(plexScopeKey(b)));
  return PlexPhysicalGroupSchema.parse({
    assetId: asset.id,
    assetVersion: asset.version,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes,
    canonicalPath: asset.path,
    ownershipEpoch: asset.ownershipEpoch,
    canonicalRootId: asset.editionRootId,
    edition: asset.edition,
    coverage,
    coverageHash: identityHash(coverage),
  });
}

/** The immutable source is loaded once per invocation; every live target and pointer is recaptured. */
export async function captureLibraryPlexExpectedV2(
  tx: Prisma.TransactionClient,
  input: {
    command: LibraryPlexBindingInputV1;
    parent: LibraryPlexParent;
    birth: LibraryCanonicalBirth;
    access: PlexAccess[];
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { command, parent, access } = input;
  const source = libraryPlexPhysicalGroup(parent);
  const { asset, group } = await readPlexPhysicalGroup(tx, command.assetId);
  const runtime = await runtimeAuthority(tx);
  if (
    !runtime.active ||
    runtime.epoch !== command.recoveryEpoch ||
    source.ownershipEpoch !== command.recoveryEpoch ||
    parent.reference.receiptId !== command.receiptId ||
    parent.reference.assetId !== command.assetId ||
    asset.state !== "published" ||
    identityHash(group) !== identityHash(source)
  )
    throw new PlexBindingProtection("ownership_changed");
  await assertNoPublicationCompensationFence(tx, {
    mediaIds: group.coverage.map((scope) => scope.mediaId),
  });
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const canonical = await readPlexCanonicalTargets(tx, group.coverage);
  assertLibraryCanonicalBirth(input.birth, canonical);
  const first = canonical[0];
  if (first === undefined)
    throw new PlexBindingProtection("unresolved_identity");
  const kind = first.kind === "movie" ? "movie" : "show";
  const server = access[0];
  if (
    server?.sectionType !== kind ||
    access.length !== 1 ||
    canonical.length !== group.coverage.length
  )
    throw new PlexBindingProtection("wrong_section");
  const targets = await readTargets(tx, canonical, command.recoveryEpoch);
  const pointers = await readPlexPointers(tx, group.coverage, budget);
  const oldGroups = priorGroups(pointers, group, server.serverMachineId);
  const expected = LibraryPlexExpectedV2Schema.parse({
    schemaVersion: 2,
    recoveryEpoch: command.recoveryEpoch,
    access,
    targets,
    previous: pointers.map((pointer) => pointer.expected),
    oldGroups,
    newGroups: [group],
    parents: [
      {
        kind: "library_adoption",
        recoveryEpoch: command.recoveryEpoch,
        reference: parent.reference,
      },
    ],
  });
  return {
    expected,
    canonicalTargets: canonical,
    writerExpiresAtMs: lease.expiresAt.getTime(),
  };
}

function priorGroups(
  pointers: Awaited<ReturnType<typeof readPlexPointers>>,
  group: ReturnType<typeof libraryPlexPhysicalGroup>,
  serverMachineId: string,
) {
  const oldGroups = new Map<string, typeof group>();
  for (const pointer of pointers) {
    if (pointer.current === null) continue;
    const prior = pointer.current.association;
    if (prior.access.serverMachineId !== serverMachineId)
      throw new PlexBindingProtection("wrong_server");
    if (
      prior.group.assetId !== group.assetId ||
      identityHash(prior.group.coverage) !== identityHash(group.coverage)
    )
      throw new PlexBindingProtection("scope_changed");
    const previous = oldGroups.get(prior.group.assetId);
    if (
      previous !== undefined &&
      identityHash(previous) !== identityHash(prior.group)
    )
      throw new Error("Library Plex prior group members disagree");
    oldGroups.set(prior.group.assetId, prior.group);
  }
  return [...oldGroups.values()];
}

async function readTargets(
  tx: Prisma.TransactionClient,
  canonical: PlexCanonicalTarget[],
  epoch: number,
) {
  const intents = await tx.mediaIntent.findMany({
    where: { OR: canonical.map((target) => target.scope) },
    include: { media: { select: { version: true } } },
  });
  const byScope = new Map(
    intents.map((intent) => [plexScopeKey(intent), intent]),
  );
  const targets = [];
  for (const target of canonical) {
    const intent = byScope.get(plexScopeKey(target.scope));
    if (
      intent?.editionRootId !== target.canonicalRootId ||
      intent.automationEpoch !== epoch
    )
      throw new PlexBindingProtection("scope_changed");
    targets.push({
      scope: target.scope,
      editionRootId: target.canonicalRootId,
      mediaVersion: intent.media.version,
      intentVersion: intent.version,
      generation: intent.generation,
      automationEpoch: intent.automationEpoch,
      definition: await readPlexDefinition(
        tx,
        target.scope,
        target.canonicalRootId,
      ),
      canonicalIdentityHash: target.canonicalIdentityHash,
      numberingHash: target.numberingHash,
    });
  }
  return targets;
}

/** Canonical/target locks precede runtime, physical assets and the configured-server claim mutex. */
export async function lockLibraryPlexScope(
  tx: Prisma.TransactionClient,
  expected: LibraryPlexExpectedV2,
  freshness: PlexBindingFreshness,
) {
  const ids = expected.targets.map((target) => target.scope.mediaId).sort();
  const assetId = expected.newGroups[0].assetId;
  const server = expected.access[0];
  if (server === undefined) throw new Error("Library Plex server missing");
  await lockCanonicalMedia(tx, ids);
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId",edition FROM "MediaIntent" WHERE "mediaId" IN (${Prisma.join(ids)}) ORDER BY "mediaId",edition FOR UPDATE`,
  );
  if (!(await lockRuntimeAuthority(tx, expected.recoveryEpoch)))
    throw new PlexBindingProtection("ownership_changed");
  await tx.$queryRaw`SELECT id FROM "UpgradeCleanup" WHERE "assetId"=${assetId} OR "successorAssetId"=${assetId} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${assetId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "assetId","mediaId",edition FROM "AssetCoverage" WHERE "assetId"=${assetId} ORDER BY "assetId","mediaId",edition FOR UPDATE`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + server.serverMachineId},0))::text`;
  freshness.assertActive();
}
