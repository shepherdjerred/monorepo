import type {
  LibraryAsset,
  Operation,
  Prisma,
  UpgradeCleanup,
} from "#generated/prisma/client.ts";
import {
  MovieFilePlanSchema,
  type MovieFilePlan,
} from "#shared/movie-editions/management/contracts.ts";
import {
  MovieUpgradeCleanupPlexExpectedV2Schema,
  MovieRestoredUpgradeCleanupPlexExpectedV3Schema,
} from "#shared/plex-binding/cleanup.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  deriveUpgradeCleanupPlan,
  UpgradeCleanupPlanSchema,
} from "#automation/files/upgrade-cleanup-plan.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { readPlexIdentityCohort } from "#infrastructure/plex-binding/groups.ts";
import { cleanupAuthorityDeadline } from "#infrastructure/plex-binding/cleanup/deadline.ts";
import { assertCleanupPhysicalAsset } from "./authority.ts";
import { movieCleanupServing } from "./serving.ts";

/** A completed scoped publication, including default v4, has a distinct physical parent. */
export async function captureMovieUpgradeCleanupExpected(
  tx: Prisma.TransactionClient,
  input: { operation: Operation; cleanup: UpgradeCleanup },
  access: readonly PlexAccess[],
  budget: PublicationAuthorityReadBudget,
) {
  const { cleanup, operation } = input;
  const attempts = await tx.acquisitionAttempt.findMany({
    where: {
      state: "completed",
      recoveryEpoch: cleanup.recoveryEpoch,
      filePlan: {
        path: ["entries"],
        array_contains: [
          {
            assetId: cleanup.successorAssetId,
            previousAssetId: cleanup.assetId,
          },
        ],
      },
    },
    take: 2,
  });
  budget.consume(attempts.length);
  if (attempts.length === 0) return null;
  const attempt = attempts[0];
  if (attempt === undefined || attempts.length !== 1)
    throw new PlexBindingProtection("ownership_changed");
  const birth = MovieFilePlanSchema.parse(attempt.filePlan);
  const scope = birth.scope;
  const entry = birth.entries[0];
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
  const controlRoot = `${CAPACITY_ROOTS.movies}/.media-control`;
  const derived = deriveUpgradeCleanupPlan({ asset, successor, controlRoot });
  const plan =
    cleanup.manifest === null
      ? derived
      : UpgradeCleanupPlanSchema.parse(cleanup.manifest);
  await assertCleanupPhysicalAsset(tx, asset.id, scope);
  await assertCleanupPhysicalAsset(tx, successor.id, scope);
  assertMovieCleanupParent({
    asset,
    successor,
    entry,
    cleanup,
    plan,
    derived,
    controlRoot,
  });
  const serving = await movieCleanupServing(tx, scope, access, budget);
  const paths = [
    ...new Set([
      ...plan.files.map((file) => file.path),
      ...serving.expected.newGroups.map((group) => group.canonicalPath),
    ]),
  ].sort();
  const expected = {
    schemaVersion: serving.expected.schemaVersion === 3 ? 3 : 2,
    scope,
    operationId: operation.id,
    cleanupId: cleanup.id,
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
    descriptorHash: identityHash(plan),
    mediaIds: [scope.mediaId],
    assetIds: [
      ...new Set([asset.id, successor.id, serving.group.assetId]),
    ].sort(),
    userIds: await readPlexIdentityCohort(tx, [scope.mediaId], []),
    targets: [
      {
        mediaId: scope.mediaId,
        generation: serving.target.generation,
        intentVersion: serving.target.version,
        automationEpoch: serving.target.automationEpoch,
      },
    ],
    groups: [serving.group],
    bindings: [serving.binding],
    access,
    serving: serving.expected,
    paths,
    pathsHash: identityHash(paths),
    authorityExpiresAt: new Date(
      await cleanupAuthorityDeadline(tx, cleanup.recoveryEpoch, access),
    ).toISOString(),
  };
  return serving.expected.schemaVersion === 3
    ? MovieRestoredUpgradeCleanupPlexExpectedV3Schema.parse(expected)
    : MovieUpgradeCleanupPlexExpectedV2Schema.parse(expected);
}

function assertMovieCleanupParent(input: {
  asset: LibraryAsset & { coverage: { current: boolean }[] };
  successor: LibraryAsset;
  entry: MovieFilePlan["entries"][0];
  cleanup: UpgradeCleanup;
  plan: ReturnType<typeof deriveUpgradeCleanupPlan>;
  derived: ReturnType<typeof deriveUpgradeCleanupPlan>;
  controlRoot: string;
}) {
  const { asset, successor, entry, cleanup, plan, derived, controlRoot } =
    input;
  if (
    identityHash(plan) !== identityHash(derived) ||
    asset.ownershipEpoch !== cleanup.recoveryEpoch ||
    successor.ownershipEpoch !== cleanup.recoveryEpoch ||
    asset.coverage.some((row) => row.current) ||
    entry.assetId !== successor.id ||
    entry.previousAssetId !== asset.id ||
    entry.previousVersion === null ||
    entry.previousVersion + 1 !== asset.version ||
    entry.previousChecksum !== asset.checksum ||
    entry.checksum !== successor.checksum ||
    asset.path !== `${controlRoot}/rollback/${entry.operationId}` ||
    asset.supersededByAssetId !== successor.id ||
    asset.rollbackExpiresAt?.getTime() !== cleanup.expiresAt.getTime() ||
    successor.plexPublishedAt === null ||
    successor.plexPublishedAt.getTime() + 7 * 86_400_000 !==
      cleanup.expiresAt.getTime()
  )
    throw new PlexBindingProtection("ownership_changed");
  const sidecars = plan.files
    .filter((file) => file.subtitleId !== null)
    .map((file) => ({
      id: file.id,
      subtitleId: file.subtitleId,
      checksum: file.checksum,
      path: file.path,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const original = entry.previousSidecars
    .map((file) => ({
      id: file.quarantineId,
      subtitleId: file.subtitleId,
      checksum: file.checksum,
      path: `${controlRoot}/quarantine/${file.quarantineId}`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (identityHash(sidecars) !== identityHash(original))
    throw new PlexBindingProtection("ownership_changed");
}
