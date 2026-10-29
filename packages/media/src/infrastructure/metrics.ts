import { z } from "zod";
import type { Database } from "./database.ts";
import { visibilityMetrics } from "./visibility/metrics.ts";
import { readCapacityView } from "./capacity/read.ts";
import { renderCapacityMetrics } from "./capacity/metrics.ts";

export async function renderMediaMetrics(
  database: Database,
  samplingEnabled = false,
): Promise<string> {
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
    SELECT COUNT(*) AS required, COUNT(w."userId") FILTER (WHERE w."observedAt" <= CURRENT_TIMESTAMP) AS observed, MIN(w."observedAt") FILTER (WHERE w."observedAt" <= CURRENT_TIMESTAMP) AS oldest
    FROM "MediaRequest" r JOIN "MediaUser" u ON u.id = r."userId"
    JOIN "MediaItem" m ON m.id = r."mediaId"
    LEFT JOIN "WatchState" w ON w."userId" = r."userId" AND w."mediaId" = r."mediaId" AND w.edition = r.edition
    WHERE r.edition = 'default' AND r.active = true AND r.excluded = false AND (r.direct = true OR EXISTS (
      SELECT 1 FROM "RequestCoverage" c JOIN "MediaRequest" root ON root.id=c."rootRequestId"
      WHERE c."requestId"=r.id AND c.edition=r.edition AND root.edition=c.edition AND c.active=true AND root.active=true AND root.excluded=false AND root.direct=true
    )) AND u.role != 'owner' AND m.availability = 'available'
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
  return (
    Object.entries(values)
      .map(
        ([name, value]) => `# TYPE ${name} gauge\n${name} ${String(value)}\n`,
      )
      .join("") +
    (await visibilityMetrics(database)) +
    renderCapacityMetrics(await readCapacityView(database, { samplingEnabled }))
  );
}
