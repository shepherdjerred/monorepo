import { z } from "zod";
import { FileGuardError, type Transaction } from "#automation/files/types.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import {
  assertPublicationActive,
  type PublicationContext,
} from "./invocation.ts";

/** Actual trusted deadlines are captured under existing authority locks; final syscall checks are synchronous. */
export async function publicationAuthorityGuard(
  tx: Transaction,
  context: PublicationContext,
  input: { libraryKind: "movies" | "tv"; recoveryEpoch: number },
): Promise<() => void> {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  assertPublicationActive(context);
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const rootPath = `/data/${input.libraryKind}`;
  await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" WHERE "rootPath"=${rootPath} FOR SHARE`;
  const storage = await tx.mediaStorageAuthority.findUnique({
    where: { rootPath },
  });
  const timestamp = Date.now();
  if (
    storage?.revokedAt !== null ||
    storage.recoveryEpoch !== input.recoveryEpoch ||
    storage.observedAt.getTime() > timestamp ||
    storage.expiresAt.getTime() <= timestamp ||
    storage.expiresAt.getTime() - storage.observedAt.getTime() > 120_000 ||
    lease.revokedAt !== null ||
    lease.recoveryEpoch !== input.recoveryEpoch ||
    lease.observedAt.getTime() > timestamp ||
    lease.expiresAt.getTime() <= timestamp
  )
    throw new FileGuardError("publication_storage_authority_expired");
  const deadlines = [lease.expiresAt.getTime(), storage.expiresAt.getTime()];
  const roots = context.roots[input.libraryKind];
  await context.verifyStorageAuthority(roots);
  if (roots.controlPolicy === "plex-excluded") {
    const proof = await requirePlexExclusionDatabaseProof(tx, {
      library: storedFilePath(context, input.libraryKind, "library", ""),
      control: storedFilePath(context, input.libraryKind, "control", ""),
    });
    const evidence = z
      .object({ topologyCheckedAt: z.iso.datetime() })
      .parse(proof.evidence);
    deadlines.push(Date.parse(evidence.topologyCheckedAt) + 900_000);
  }
  const deadline = Math.min(...deadlines);
  const monotonicDeadline = observed.monotonic + (deadline - observed.wall);
  if (!Number.isFinite(deadline) || !Number.isFinite(monotonicDeadline))
    throw new FileGuardError("publication_authority_expired");
  const assertActive = () => {
    assertPublicationActive(context);
    if (Date.now() >= deadline || performance.now() >= monotonicDeadline)
      throw new FileGuardError("publication_authority_expired");
  };
  assertActive();
  return assertActive;
}
