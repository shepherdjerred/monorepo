import { Counter, Gauge } from "prom-client";
import { createLogger } from "#src/logger.ts";
import { registry } from "#src/metrics/registry.ts";

const logger = createLogger("metrics-temporal");

export const scoutTemporalConnected = new Gauge({
  name: "scout_temporal_connected",
  help: "Whether the embedded Scout Temporal worker supervisor is connected",
  registers: [registry],
});

export const scoutTemporalWorkers = new Gauge({
  name: "scout_temporal_workers",
  help: "Number of running embedded Scout Temporal workers",
  labelNames: ["queue_class"] as const,
  registers: [registry],
});

export const scoutTemporalReconnects = new Counter({
  name: "scout_temporal_reconnects_total",
  help: "Temporal supervisor reconnect attempts after startup",
  registers: [registry],
});

export const scoutTemporalStartsRejected = new Counter({
  name: "scout_temporal_starts_rejected_total",
  help: "Durable starts rejected while Temporal is degraded or shutting down",
  labelNames: ["reason"] as const,
  registers: [registry],
});

export const scoutTemporalReportOutboxOldestTimestamp = new Gauge({
  name: "scout_temporal_report_outbox_oldest_timestamp_seconds",
  help: "Creation timestamp of the oldest unprocessed report Schedule outbox row, or zero when empty",
  registers: [registry],
});

export const scoutTemporalReportScheduleDrift = new Gauge({
  name: "scout_temporal_report_schedule_drift",
  help: "Desired Scout report Schedules that are missing or differ from their closed-world definition",
  registers: [registry],
});

export const scoutTemporalReportScheduleOrphans = new Gauge({
  name: "scout_temporal_report_schedule_orphans",
  help: "Strictly owned Scout report Schedules whose report is absent or disabled",
  registers: [registry],
});

export const scoutTemporalStaleProductProjections = new Gauge({
  name: "scout_temporal_stale_product_projections",
  help: "Interactive product projections still active after the maximum Workflow execution budget",
  registers: [registry],
});

export const scoutTemporalInterruptedProviderAttempts = new Counter({
  name: "scout_temporal_interrupted_provider_attempts_total",
  help: "Provider attempts interrupted rather than retried after an ambiguous start",
  labelNames: ["kind"] as const,
  registers: [registry],
});

export const scoutTemporalDuplicateEffectClaims = new Counter({
  name: "scout_temporal_duplicate_effect_claims_total",
  help: "Repeated durable external-effect claims by outcome",
  labelNames: ["kind", "outcome"] as const,
  registers: [registry],
});

export async function updateScoutTemporalDurabilityMetrics(): Promise<void> {
  try {
    const { prisma } = await import("#src/database/index.ts");
    const staleBefore = new Date(Date.now() - 40 * 60 * 1000);
    const [oldestOutbox, staleProjectionCount] = await Promise.all([
      prisma.reportScheduleOutbox.findFirst({
        where: { processedAt: null },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.scoutInteractiveRun.count({
        where: {
          state: { in: ["PENDING", "RUNNING"] },
          updatedAt: { lt: staleBefore },
        },
      }),
    ]);
    scoutTemporalReportOutboxOldestTimestamp.set(
      oldestOutbox === null ? 0 : oldestOutbox.createdAt.getTime() / 1000,
    );
    scoutTemporalStaleProductProjections.set(staleProjectionCount);
  } catch (error) {
    scoutTemporalReportOutboxOldestTimestamp.set(-1);
    scoutTemporalStaleProductProjections.set(-1);
    logger.error("Failed to update Scout Temporal durability metrics", {
      error,
    });
  }
}
