import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";

const Rows = z.array(z.object({ state: z.string(), count: z.bigint() }));
function gauge(name: string, raw: unknown, states: readonly string[]) {
  const rows = Rows.parse(raw);
  if (rows.some((row) => !states.includes(row.state)))
    throw new Error("Unknown visibility metric state");
  return (
    `# TYPE ${name} gauge\n` +
    states
      .map(
        (state) =>
          `${name}{state="${state}"} ${String(rows.find((row) => row.state === state)?.count ?? 0n)}\n`,
      )
      .join("")
  );
}

/** Aggregates only; identifiers and raw provider errors never become metric labels. */
export async function visibilityMetrics(db: Database): Promise<string> {
  const attempts = await db.$queryRaw`
    SELECT CASE WHEN a."recoveryEpoch" != r."recoveryEpoch" THEN 'old_epoch'
      WHEN a.state IN ('reserved','submitting','submission_unknown','downloading','ready','validating','imported','completed','cancelled','failed','rolled_back','obsolete','rejected') THEN a.state ELSE 'unknown' END AS state, COUNT(*) AS count
    FROM "AcquisitionAttempt" a CROSS JOIN "MediaRuntimeState" r WHERE r.id='singleton' GROUP BY 1`;
  const observations = await db.$queryRaw`
    SELECT CASE WHEN t."ownershipEpoch" != r."recoveryEpoch" THEN 'old_epoch'
      WHEN t."observedAt" IS NULL OR t.observation IS NULL THEN 'missing'
      WHEN t."observedAt" > CURRENT_TIMESTAMP THEN 'future'
      WHEN t."observedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes' THEN 'stale' ELSE 'fresh' END AS state, COUNT(*) AS count
    FROM "Torrent" t CROSS JOIN "MediaRuntimeState" r WHERE r.id='singleton' GROUP BY 1`;
  const cleanup = await db.$queryRaw`
    SELECT CASE WHEN t."cleanupEvaluation" IS NULL THEN 'missing'
      WHEN t."ownershipEpoch" != r."recoveryEpoch" OR t."cleanupEvaluation"->>'recoveryEpoch' != r."recoveryEpoch"::text THEN 'old_epoch'
      WHEN (t."cleanupEvaluation"->>'evaluatedAt')::timestamptz > CURRENT_TIMESTAMP THEN 'future'
      WHEN (t."cleanupEvaluation"->>'evaluatedAt')::timestamptz < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
        OR t."cleanupEvaluation"->>'databaseDigest' IS DISTINCT FROM md5(jsonb_build_array(t."seedingPolicy",t.observation)::text)
        OR (t."cleanupEvaluation"->>'observedAt')::timestamptz IS DISTINCT FROM t."observedAt" THEN 'stale'
      WHEN t."cleanupEvaluation"->>'status' IN ('removed','protected','seeding','removable') THEN t."cleanupEvaluation"->>'status' ELSE 'unknown' END AS state, COUNT(*) AS count
    FROM "Torrent" t CROSS JOIN "MediaRuntimeState" r WHERE r.id='singleton' GROUP BY 1`;
  const providers = await db.$queryRaw`
    SELECT CASE WHEN NOT enabled THEN 'disabled' WHEN "lastError" IS NOT NULL THEN 'intervention' ELSE 'enabled' END AS state, COUNT(*) AS count FROM "MediaProvider" GROUP BY 1`;
  const subtitles = await db.$queryRaw`
    SELECT CASE WHEN "ownershipEpoch" != r."recoveryEpoch" THEN 'old_epoch'
      WHEN s.state IN ('requested','validated','installed','quarantined','failed','purged','superseded') THEN s.state ELSE 'other' END AS state, COUNT(*) AS count
    FROM "SubtitleAsset" s CROSS JOIN "MediaRuntimeState" r WHERE r.id='singleton' GROUP BY 1`;
  const deliveries = await db.$queryRaw`
    SELECT CASE WHEN n."recoveryEpoch" != r."recoveryEpoch" THEN 'old_epoch'
      WHEN n.state IN ('pending','sending','accepted','failed','rejected','unknown') THEN n.state ELSE 'other' END AS state, COUNT(*) AS count
    FROM "NotificationDelivery" n CROSS JOIN "MediaRuntimeState" r WHERE r.id='singleton' GROUP BY 1`;
  return [
    gauge("media_acquisition_attempts", attempts, [
      "reserved",
      "submitting",
      "submission_unknown",
      "downloading",
      "ready",
      "validating",
      "imported",
      "completed",
      "cancelled",
      "failed",
      "rolled_back",
      "obsolete",
      "rejected",
      "old_epoch",
      "unknown",
    ]),
    gauge("media_download_observations", observations, [
      "fresh",
      "stale",
      "missing",
      "future",
      "old_epoch",
    ]),
    gauge("media_source_cleanup_evaluations", cleanup, [
      "removed",
      "protected",
      "seeding",
      "removable",
      "missing",
      "stale",
      "future",
      "old_epoch",
      "unknown",
    ]),
    gauge("media_provider_states", providers, [
      "disabled",
      "intervention",
      "enabled",
    ]),
    gauge("media_subtitle_work", subtitles, [
      "requested",
      "validated",
      "installed",
      "quarantined",
      "failed",
      "purged",
      "superseded",
      "old_epoch",
      "other",
    ]),
    gauge("media_notification_delivery_states", deliveries, [
      "pending",
      "sending",
      "accepted",
      "failed",
      "rejected",
      "unknown",
      "old_epoch",
      "other",
    ]),
  ].join("");
}
