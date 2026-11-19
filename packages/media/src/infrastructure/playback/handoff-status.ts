import type { Database } from "#infrastructure/database.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";

/** Latest stored observation only, possibly stale. Sealing independently
 * validates current writer/runtime authority, snapshot and Plex sessions. */
export async function readPlaybackLegacyWriterObservation(
  db: Pick<Database, "legacyWriterLease">,
) {
  const lease = await db.legacyWriterLease.findUnique({
    where: { id: "singleton" },
  });
  if (lease?.revokedAt !== null) return null;
  // Malformed unrevoked internal evidence is an error, not absent evidence.
  const observation = QuiescenceEvidenceSchema.parse(lease.observation);
  return {
    capturedAt: observation.capturedAt,
    expiresAt: observation.expiresAt,
    inventoryDigest: observation.inventoryDigest,
  };
}
