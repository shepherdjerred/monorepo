import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

export async function retentionDeadline(
  tx: Prisma.TransactionClient,
  access: readonly PlexAccess[],
  execution: Pick<
    PlexBindingExecution,
    "observed" | "expiresAtMs" | "assertActive"
  >,
) {
  const initial = plexBindingFreshness({ ...execution, guards: [execution] });
  const runtime = await runtimeAuthority(tx);
  initial.assertActive();
  if (!runtime.active) throw new PlexBindingProtection("ownership_changed");
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  initial.assertActive();
  const deadlines = [initial.expiresAtMs, lease.expiresAt.getTime()];
  for (const configured of access) {
    const rootPath =
      configured.sectionType === "movie" ? "/data/movies" : "/data/tv";
    const storage = await tx.mediaStorageAuthority.findUnique({
      where: { rootPath },
    });
    initial.assertActive();
    if (
      storage?.revokedAt !== null ||
      storage.recoveryEpoch !== runtime.epoch ||
      storage.observedAt.getTime() > Date.now() ||
      storage.expiresAt.getTime() - storage.observedAt.getTime() > 120_000
    )
      throw new PlexBindingProtection("ownership_changed");
    deadlines.push(storage.expiresAt.getTime());
  }
  return plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(...deadlines),
    guards: [initial],
  });
}
