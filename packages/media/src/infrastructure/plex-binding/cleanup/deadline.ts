import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

/** Storage and writer bounds use real clocks, independently of retention policy time. */
export async function cleanupAuthorityDeadline(
  tx: Prisma.TransactionClient,
  epoch: number,
  access: readonly PlexAccess[],
) {
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    lease.revokedAt !== null ||
    lease.recoveryEpoch !== epoch ||
    lease.observedAt.getTime() > Date.now() ||
    lease.expiresAt.getTime() <= Date.now()
  )
    throw new PlexBindingProtection("verification_expired");
  const deadlines = [lease.expiresAt.getTime()];
  for (const item of access) {
    const library =
      CAPACITY_ROOTS[item.sectionType === "movie" ? "movies" : "tv"];
    const storage = await tx.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: library },
    });
    if (
      storage.revokedAt !== null ||
      storage.recoveryEpoch !== epoch ||
      storage.observedAt.getTime() > Date.now() ||
      storage.expiresAt.getTime() <= Date.now() ||
      storage.expiresAt.getTime() - storage.observedAt.getTime() > 120_000
    )
      throw new PlexBindingProtection("verification_expired");
    const exclusion = await requirePlexExclusionDatabaseProof(tx, {
      library,
      control: `${library}/.media-control`,
    });
    if (
      exclusion.serverMachineId !== item.serverMachineId ||
      exclusion.sectionId !== item.sectionId
    )
      throw new PlexBindingProtection("wrong_section");
    deadlines.push(
      storage.expiresAt.getTime(),
      Date.parse(
        z
          .object({ topologyCheckedAt: z.iso.datetime() })
          .parse(exclusion.evidence).topologyCheckedAt,
      ) + 900_000,
    );
  }
  return Math.min(...deadlines);
}
