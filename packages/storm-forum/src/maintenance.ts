import { open, unlink } from "node:fs/promises";
import { z } from "zod";

/**
 * The forum's maintenance fence. While it exists nginx answers 503, readiness
 * fails, Delivery's status reports unsettled and housekeeping is skipped.
 */
export const MAINTENANCE_MARKER = "/var/lib/storm-forum/.maintenance";
const OwnerSchema = z.uuid();
export const MaintenanceMarkerSchema = z
  .object({ owner: OwnerSchema, startedAt: z.number() })
  .strict();

export async function beginForumMaintenance(owner: string): Promise<void> {
  OwnerSchema.parse(owner);
  if (await Bun.file(MAINTENANCE_MARKER).exists()) {
    const marker = MaintenanceMarkerSchema.parse(
      await Bun.file(MAINTENANCE_MARKER).json(),
    );
    if (marker.owner !== owner) {
      throw new Error("Forum maintenance belongs to a different execution");
    }
    return;
  }
  const handle = await open(MAINTENANCE_MARKER, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ owner, startedAt: Date.now() }));
  } finally {
    await handle.close();
  }
}

export async function endForumMaintenance(owner: string): Promise<void> {
  OwnerSchema.parse(owner);
  if (!(await Bun.file(MAINTENANCE_MARKER).exists())) {
    return;
  }
  const marker = MaintenanceMarkerSchema.parse(
    await Bun.file(MAINTENANCE_MARKER).json(),
  );
  if (marker.owner !== owner) {
    throw new Error(
      "Refusing to release another execution's maintenance window",
    );
  }
  await unlink(MAINTENANCE_MARKER);
}
