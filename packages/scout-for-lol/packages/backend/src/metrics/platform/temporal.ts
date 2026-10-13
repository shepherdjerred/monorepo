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
  labelNames: ["temporal_namespace"] as const,
  registers: [registry],
});

export const scoutTemporalReportScheduleOrphans = new Gauge({
  name: "scout_temporal_report_schedule_orphans",
  help: "Strictly owned Scout report Schedules whose report is absent or disabled",
  labelNames: ["temporal_namespace"] as const,
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

export const scoutCustomOperations = new Gauge({
  name: "scout_custom_operations",
  help: "Customs operations awaiting execution or manager resolution",
  labelNames: ["state"] as const,
  registers: [registry],
});
export const scoutCustomOperationOldestTimestamp = new Gauge({
  name: "scout_custom_operation_oldest_timestamp_seconds",
  help: "Creation time of the oldest unfinished Customs operation, zero when empty",
  registers: [registry],
});
export const scoutProductFollowUpOldestTimestamp = new Gauge({
  name: "scout_product_follow_up_oldest_timestamp_seconds",
  help: "Delivery time of the oldest announcement missing required bookkeeping, zero when empty",
  registers: [registry],
});

export async function updateScoutTemporalDurabilityMetrics(): Promise<void> {
  try {
    const { prisma } = await import("#src/database/index.ts");
    const staleBefore = new Date(Date.now() - 40 * 60 * 1000);
    const [
      oldestOutbox,
      staleProjectionCount,
      customStates,
      oldestCustom,
      oldestFollowUp,
    ] = await Promise.all([
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
      prisma.customNightOperation.groupBy({
        by: ["state"],
        where: { state: { in: ["queued", "running", "held"] } },
        _count: { _all: true },
      }),
      prisma.customNightOperation.findFirst({
        where: { state: { in: ["queued", "running", "held"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.matchNotificationIntent.findFirst({
        where: {
          kind: "product-announcement",
          state: "delivered",
          followUpCompletedAt: null,
        },
        orderBy: { deliveredAt: "asc" },
        select: { deliveredAt: true },
      }),
    ]);
    scoutTemporalReportOutboxOldestTimestamp.set(
      oldestOutbox === null ? 0 : oldestOutbox.createdAt.getTime() / 1000,
    );
    scoutTemporalStaleProductProjections.set(staleProjectionCount);
    for (const state of ["queued", "running", "held"])
      scoutCustomOperations.set(
        { state },
        customStates.find((row) => row.state === state)?._count._all ?? 0,
      );
    scoutCustomOperationOldestTimestamp.set(
      oldestCustom === null ? 0 : oldestCustom.createdAt.getTime() / 1000,
    );
    let followUpSeconds = 0;
    if (oldestFollowUp !== null) {
      if (oldestFollowUp.deliveredAt === null)
        throw new Error("Delivered announcement has no delivery timestamp");
      followUpSeconds = oldestFollowUp.deliveredAt.getTime() / 1000;
    }
    scoutProductFollowUpOldestTimestamp.set(followUpSeconds);
  } catch (error) {
    scoutTemporalReportOutboxOldestTimestamp.set(-1);
    scoutTemporalStaleProductProjections.set(-1);
    for (const state of ["queued", "running", "held"])
      scoutCustomOperations.set({ state }, -1);
    scoutCustomOperationOldestTimestamp.set(-1);
    scoutProductFollowUpOldestTimestamp.set(-1);
    logger.error("Failed to update Scout Temporal durability metrics", {
      error,
    });
  }
}
