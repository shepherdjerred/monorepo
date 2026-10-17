import { z } from "zod";
import type { Database } from "./database.ts";

export async function renderMediaMetrics(database: Database): Promise<string> {
  const pending = await database.outboxCommand.count({
    where: { dispatchedAt: null },
  });
  const oldest = await database.outboxCommand.findFirst({
    where: { dispatchedAt: null },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const uncertain = await database.operation.count({
    where: { status: "reconciling" },
  });
  const runtime = await database.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const rows = z
    .array(
      z.object({
        required: z.bigint(),
        observed: z.bigint(),
        oldest: z.date().nullable(),
      }),
    )
    .length(1)
    .parse(
      await database.$queryRaw`
    SELECT COUNT(*) AS required, COUNT(w."userId") AS observed, MIN(w."observedAt") AS oldest
    FROM "MediaRequest" r JOIN "MediaUser" u ON u.id = r."userId"
    JOIN "MediaItem" m ON m.id = r."mediaId"
    LEFT JOIN "WatchState" w ON w."userId" = r."userId" AND w."mediaId" = r."mediaId"
    WHERE r.active = true AND u.role != 'owner' AND m.availability = 'available'
  `,
    );
  const watch = rows[0];
  if (watch === undefined)
    throw new Error("Watch metrics query returned no row");
  const values = {
    media_outbox_pending: pending,
    media_outbox_oldest_age_seconds:
      oldest === null
        ? 0
        : Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000),
    media_operations_reconciling: uncertain,
    media_watch_evidence_required:
      watch.required > 0n && runtime.mode === "active" ? 1 : 0,
    media_watch_evidence_oldest_timestamp_seconds:
      watch.required !== watch.observed || watch.oldest === null
        ? 0
        : watch.oldest.getTime() / 1000,
    media_runtime_active:
      runtime.mode === "active" && runtime.ownershipConfirmed ? 1 : 0,
  };
  return Object.entries(values)
    .map(([name, value]) => `# TYPE ${name} gauge\n${name} ${String(value)}\n`)
    .join("");
}
