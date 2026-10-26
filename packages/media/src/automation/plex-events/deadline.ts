import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { WatchAuthority } from "./authority.ts";

/** Capture verified lease/storage expiries once; later renewals cannot extend this observation. */
export async function watchDeadline(
  tx: Prisma.TransactionClient,
  authority: WatchAuthority,
  execution: PlexBindingExecution,
) {
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  execution.assertActive();
  const rootPath =
    authority.media.kind === "movie" ? "/data/movies" : "/data/tv";
  const storage = await tx.mediaStorageAuthority.findUnique({
    where: { rootPath },
  });
  execution.assertActive();
  if (
    storage?.revokedAt !== null ||
    storage.recoveryEpoch !== authority.runtime.recoveryEpoch ||
    storage.observedAt.getTime() > Date.now() ||
    storage.expiresAt.getTime() - storage.observedAt.getTime() > 120_000
  )
    throw new PlexBindingProtection("ownership_changed");
  return plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      execution.expiresAtMs,
      lease.expiresAt.getTime(),
      storage.expiresAt.getTime(),
    ),
    guards: [execution],
  });
}
