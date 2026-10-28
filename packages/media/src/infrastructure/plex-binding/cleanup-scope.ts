import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import {
  UpgradeCleanupPlanSchema,
  type UpgradeCleanupPlan,
} from "#shared/native-recovery/archive-plan.ts";
import { deriveUpgradeCleanupPlan } from "#automation/files/upgrade-cleanup-plan.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  lockCanonicalMedia,
  lockExistingDefaultTargets,
} from "#infrastructure/editions/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import {
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import {
  UpgradeCleanupPlexExpectedSchema,
  UpgradeCleanupPlexInputSchema,
  type UpgradeCleanupPlexExpected,
  type UpgradeCleanupPlexInput,
} from "#shared/plex-binding/cleanup.ts";
import {
  PlexAccessSchema,
  type PlexAccess,
  type PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import { readPlexGroupUnion, readPlexIdentityCohort } from "./groups.ts";
import { readCurrentPlexBindings } from "./read.ts";
import { PlexBindingProtection } from "./errors.ts";
import { captureExistingPlexBindingExpected } from "./cold.ts";
import { captureMovieUpgradeCleanupExpected } from "#infrastructure/movie-editions/cleanup/expected.ts";
import type { CleanupReadInvocation } from "./cleanup/invocation.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { movieCleanupRecordsAuthorized } from "#infrastructure/movie-editions/cleanup/authority.ts";
import { cleanupAuthorityDeadline } from "./cleanup/deadline.ts";

/** Exact existing purged-row ACK, not a new immutable purge receipt. No fresh access lookup. */
export async function readUpgradeCleanupCommand(
  tx: Prisma.TransactionClient,
  raw: UpgradeCleanupPlexInput,
) {
  const input = UpgradeCleanupPlexInputSchema.parse(raw);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const cleanup = await tx.upgradeCleanup.findUniqueOrThrow({
    where: { id: input.cleanupId },
  });
  const command = z
    .object({
      kind: z.literal("cleanup_upgrade"),
      operationId: z.uuid(),
      cleanupId: z.uuid(),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== command.kind ||
    operation.targetId !== cleanup.id ||
    command.operationId !== operation.id ||
    command.cleanupId !== cleanup.id ||
    command.recoveryEpoch !== cleanup.recoveryEpoch
  )
    throw new Error("Upgrade cleanup operation linkage changed");
  return { operation, cleanup };
}

/** Read-only derivation; Files still certifies the original import/purge journals. */
export async function captureUpgradeCleanupExpected(
  tx: Prisma.TransactionClient,
  input: UpgradeCleanupPlexInput,
  rawAccess: readonly PlexAccess[],
  invocation: CleanupReadInvocation,
) {
  const { operation, cleanup } = await readUpgradeCleanupCommand(tx, input);
  if (cleanup.state !== "pending" || cleanup.expiresAt > invocation.policyTime)
    throw new PlexBindingProtection("reconciliation_required");
  const movie = await captureMovieUpgradeCleanupExpected(
    tx,
    { operation, cleanup },
    rawAccess,
    invocation.budget,
  );
  if (movie !== null) return movie;
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: cleanup.assetId },
    include: {
      coverage: { include: { media: true }, orderBy: { mediaId: "asc" } },
      subtitles: { where: videoSubtitleWhere, orderBy: { id: "asc" } },
    },
  });
  const successor = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: cleanup.successorAssetId },
  });
  const kind = asset.coverage[0]?.media.kind;
  if (kind !== "movie" && kind !== "episode")
    throw new PlexBindingProtection("scope_changed");
  const libraryKind = kind === "movie" ? "movies" : "tv";
  const controlRoot = `${CAPACITY_ROOTS[libraryKind]}/.media-control`;
  const derived = deriveUpgradeCleanupPlan({ asset, successor, controlRoot });
  const plan =
    cleanup.manifest === null
      ? derived
      : UpgradeCleanupPlanSchema.parse(cleanup.manifest);
  if (
    identityHash(cleanupPlanMembership(plan)) !==
    identityHash(cleanupPlanMembership(derived))
  )
    throw new Error(
      "Upgrade cleanup stored descriptor differs from exact derivation",
    );
  if (
    asset.coverage.some((row) => row.current) ||
    asset.supersededByAssetId !== successor.id ||
    asset.rollbackExpiresAt?.getTime() !== cleanup.expiresAt.getTime() ||
    successor.plexPublishedAt === null ||
    successor.plexPublishedAt.getTime() + 7 * 86_400_000 !==
      cleanup.expiresAt.getTime()
  )
    throw new PlexBindingProtection("ownership_changed");
  const descriptorHash = identityHash(plan);
  const attempts = await tx.acquisitionAttempt.findMany({
    where: {
      state: "completed",
      recoveryEpoch: cleanup.recoveryEpoch,
      filePlan: {
        array_contains: [{ assetId: successor.id, previousAssetId: asset.id }],
      },
    },
    take: 2,
  });
  const attempt = cleanupAttempt(attempts, {
    asset,
    successor,
    plan,
    controlRoot,
  });
  const union = await readPlexGroupUnion(tx, plan.mediaIds);
  const { access, bindings, targets } = await cleanupServing(
    tx,
    union,
    rawAccess,
  );
  const paths = [
    ...new Set([
      ...plan.files.map((file) => file.path),
      ...union.newGroups.map((group) => group.canonicalPath),
    ]),
  ].sort();
  return UpgradeCleanupPlexExpectedSchema.parse({
    schemaVersion: 1,
    ...input,
    commandHash: identityHash(operation.payload),
    recoveryEpoch: cleanup.recoveryEpoch,
    cleanup: {
      version: cleanup.version,
      assetId: asset.id,
      successorAssetId: successor.id,
      expiresAt: cleanup.expiresAt.toISOString(),
      manifestHash:
        cleanup.manifest === null ? null : identityHash(cleanup.manifest),
    },
    publication: {
      attemptId: attempt.id,
      operationId: attempt.operationId,
      filePlanHash: identityHash(attempt.filePlan),
    },
    plan,
    descriptorHash,
    mediaIds: union.mediaIds,
    assetIds: [
      ...new Set([
        asset.id,
        successor.id,
        ...union.oldGroups.map((group) => group.assetId),
        ...union.newGroups.map((group) => group.assetId),
      ]),
    ].sort(),
    userIds: await readPlexIdentityCohort(tx, union.mediaIds, []),
    targets: targets.map(({ version, ...target }) => ({
      ...target,
      intentVersion: version,
    })),
    groups: union.newGroups,
    bindings,
    access,
    serving: await captureExistingPlexBindingExpected(tx, {
      assetIds: union.newGroups.map((group) => group.assetId),
      access,
    }),
    paths,
    pathsHash: identityHash(paths),
    authorityExpiresAt: new Date(
      await cleanupAuthorityDeadline(tx, cleanup.recoveryEpoch, access),
    ).toISOString(),
  });
}

function cleanupAttempt(
  attempts: { id: string; operationId: string; filePlan: unknown }[],
  input: {
    asset: {
      id: string;
      version: number;
      checksum: string | null;
      path: string;
    };
    successor: { id: string; checksum: string | null };
    plan: UpgradeCleanupPlan;
    controlRoot: string;
  },
) {
  const { asset, successor, plan, controlRoot } = input;
  const attempt = attempts[0];
  if (attempt === undefined || attempts.length !== 1)
    throw new PlexBindingProtection("ownership_changed");
  const entries = FilePlanSchema.parse(attempt.filePlan).filter(
    (entry) =>
      entry.assetId === successor.id && entry.previousAssetId === asset.id,
  );
  const entry = entries[0];
  if (
    entry === undefined ||
    entries.length !== 1 ||
    entry.previousVersion === null ||
    entry.previousVersion + 1 !== asset.version ||
    entry.previousChecksum !== asset.checksum ||
    entry.checksum !== successor.checksum ||
    identityHash([...entry.mediaIds].sort()) !== identityHash(plan.mediaIds) ||
    asset.path !== `${controlRoot}/rollback/${entry.operationId}`
  )
    throw new PlexBindingProtection("ownership_changed");
  return attempt;
}

async function cleanupServing(
  tx: Prisma.TransactionClient,
  union: Awaited<ReturnType<typeof readPlexGroupUnion>>,
  rawAccess: readonly PlexAccess[],
) {
  const access = rawAccess.map((value) => PlexAccessSchema.parse(value));
  const server = access[0]?.serverMachineId;
  if (
    server === undefined ||
    access.some((value) => value.serverMachineId !== server) ||
    union.oldServerMachineIds.some((value) => value !== server)
  )
    throw new PlexBindingProtection("wrong_server");
  const reads = [];
  for (const group of union.newGroups) {
    const sectionType = group.canonicalPath.startsWith(
      `${CAPACITY_ROOTS.movies}/`,
    )
      ? "movie"
      : "show";
    const selected = access.filter(
      (value) => value.sectionType === sectionType,
    );
    const selectedAccess = selected[0];
    if (selectedAccess === undefined || selected.length !== 1)
      throw new PlexBindingProtection("wrong_section");
    reads.push(
      ...group.coverage.map((scope) => ({
        scope,
        assetId: group.assetId,
        access: selectedAccess,
      })),
    );
  }
  const currentBindings = await readCurrentPlexBindings(tx, reads);
  const bindings = currentBindings
    .map((read) => {
      if (read.status !== "current")
        throw new PlexBindingProtection(read.reason);
      return read.snapshot;
    })
    .sort((a, b) => a.scope.mediaId.localeCompare(b.scope.mediaId));
  const targets = await tx.mediaIntent.findMany({
    where: { mediaId: { in: union.mediaIds }, edition: "default" },
    orderBy: { mediaId: "asc" },
    select: {
      mediaId: true,
      generation: true,
      version: true,
      automationEpoch: true,
    },
  });
  if (targets.length !== union.mediaIds.length || union.newGroups.length === 0)
    throw new PlexBindingProtection("scope_changed");
  const requiredKinds = [
    ...new Set(reads.map((read) => read.access.sectionType)),
  ].sort();
  if (
    identityHash(requiredKinds) !==
      identityHash(access.map((value) => value.sectionType)) ||
    new Set(access.map((value) => value.sectionId)).size !== access.length
  )
    throw new PlexBindingProtection("wrong_section");
  return { access, bindings, targets };
}

function cleanupPlanMembership(plan: UpgradeCleanupPlan) {
  return {
    ...plan,
    mediaIds: [...plan.mediaIds].sort(),
    files: [...plan.files].sort((a, b) =>
      `${a.location}/${a.id}/${a.subtitleId ?? ""}`.localeCompare(
        `${b.location}/${b.id}/${b.subtitleId ?? ""}`,
      ),
    ),
  };
}

/** Complete union first, server mutex last. Call before any independent leaf/asset locks. */
export async function lockUpgradeCleanupObservation(
  tx: Prisma.TransactionClient,
  expected: UpgradeCleanupPlexExpected,
  freshness: PlexBindingFreshness,
) {
  freshness.assertActive();
  if (expected.schemaVersion === 2) await lockMovieCommand(tx, expected.scope);
  else {
    await lockCanonicalMedia(tx, expected.mediaIds);
    await lockExistingDefaultTargets(tx, expected.mediaIds);
    await lockEffectiveRequests(tx, expected.mediaIds);
  }
  if (!(await lockRuntimeAuthority(tx, expected.recoveryEpoch)))
    throw new PlexBindingProtection("ownership_changed");
  if (expected.userIds.length > 0) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(expected.userIds)}) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(expected.userIds)}) ORDER BY "userId" FOR SHARE`,
    );
  }
  await tx.$queryRaw`SELECT id FROM "UpgradeCleanup" WHERE id=${expected.cleanupId} FOR UPDATE`;
  await assertNoSubtitleReplacement(tx, expected.assetIds);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(expected.assetIds)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(expected.assetIds)}) ORDER BY "assetId","mediaId" FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "SubtitleAsset" WHERE "assetId" IN (${Prisma.join(expected.assetIds)}) ORDER BY id FOR SHARE`,
  );
  await assertNoPublicationCompensationFence(tx, expected);
  if (
    !(await (expected.schemaVersion === 2
      ? movieCleanupRecordsAuthorized(tx, expected)
      : recordsAuthorized(tx, {
          epoch: expected.recoveryEpoch,
          mediaIds: expected.mediaIds,
          assetIds: expected.assetIds,
        })))
  )
    throw new PlexBindingProtection("ownership_changed");
  const server = expected.access[0]?.serverMachineId;
  if (server === undefined) throw new Error("Cleanup access missing");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + server},0))::text`;
  freshness.assertActive();
}
