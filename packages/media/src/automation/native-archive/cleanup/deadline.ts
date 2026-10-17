import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeArchiveCleanupNetworkEvidenceSchema } from "#shared/native-recovery/archive.ts";
import { NativeArchiveProtection } from "#infrastructure/native-archive/continuation.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import {
  assertArchiveActive,
  type ArchiveFileContext,
} from "#automation/native-archive/execution.ts";

/** No serialized authority: capture already-verified deadlines while the actual rows remain locked. */
export async function archiveCleanupDeadline(
  tx: Prisma.TransactionClient,
  context: ArchiveFileContext,
  input: {
    network: z.infer<typeof NativeArchiveCleanupNetworkEvidenceSchema>;
    observed: { wall: number; monotonic: number };
  },
): Promise<() => void> {
  const { network, observed } = input;
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const deadlines = [network, network.quiescence, network.mounts].map((item) =>
    Date.parse(item.expiresAt),
  );
  assertLease(lease, network.recoveryEpoch);
  deadlines.push(lease.expiresAt.getTime());
  for (const kind of ["movies", "tv"] as const) {
    const rootPath = `/data/${kind}`;
    await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" WHERE "rootPath"=${rootPath} FOR SHARE`;
    const storage = await tx.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath },
    });
    assertLease(storage, network.recoveryEpoch);
    if (
      storage.workerPodUid !== context.workerPodUid ||
      storage.expiresAt.getTime() - storage.observedAt.getTime() > 120_000
    )
      throw new NativeArchiveProtection("archive_storage_authority_changed");
    deadlines.push(storage.expiresAt.getTime());
    if (context.files.roots[kind].controlPolicy === "plex-excluded") {
      await tx.$queryRaw`SELECT id FROM "PlexExclusionProof" WHERE "libraryRoot"=${rootPath} ORDER BY id FOR SHARE`;
      const proof = await requirePlexExclusionDatabaseProof(tx, {
        library: rootPath,
        control: `${rootPath}/.media-control`,
      });
      const evidence = z
        .object({ topologyCheckedAt: z.iso.datetime() })
        .parse(proof.evidence);
      deadlines.push(Date.parse(evidence.topologyCheckedAt) + 900_000);
    }
  }
  const deadline = Math.min(...deadlines);
  const monotonicDeadline = observed.monotonic + deadline - observed.wall;
  const assertActive = () => {
    assertArchiveActive(context.execution);
    if (
      !Number.isFinite(deadline) ||
      !Number.isFinite(monotonicDeadline) ||
      Date.now() >= deadline ||
      performance.now() >= monotonicDeadline
    )
      throw new NativeArchiveProtection("archive_authority_expired");
  };
  assertActive();
  return assertActive;
}

function assertLease(
  row: {
    recoveryEpoch: number;
    observedAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  },
  epoch: number,
): void {
  if (
    row.recoveryEpoch !== epoch ||
    row.revokedAt !== null ||
    row.observedAt.getTime() > Date.now() ||
    row.expiresAt.getTime() <= Date.now()
  )
    throw new NativeArchiveProtection("archive_authority_expired");
}
