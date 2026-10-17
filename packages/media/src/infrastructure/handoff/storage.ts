import type { Database } from "#infrastructure/database.ts";
import { runtimeAuthority } from "./authority.ts";

/** Called after the effect's runtime SHARE lock; refresh/revocation takes runtime UPDATE. */
export async function requireStorageAuthority(
  db: Database,
  rootPath: string,
  workerPodUid: string,
): Promise<void> {
  const runtime = await runtimeAuthority(db);
  const authority = await db.mediaStorageAuthority.findUnique({
    where: { rootPath },
  });
  const timestamp = Date.now();
  if (
    authority?.revokedAt !== null ||
    !runtime.active ||
    authority.recoveryEpoch !== runtime.epoch ||
    authority.workerPodUid !== workerPodUid ||
    authority.observedAt.getTime() > timestamp ||
    authority.expiresAt.getTime() <= timestamp ||
    authority.expiresAt.getTime() - authority.observedAt.getTime() > 120_000
  )
    throw new Error(
      "Media storage authority is absent, stale, or belongs to another executor",
    );
}
