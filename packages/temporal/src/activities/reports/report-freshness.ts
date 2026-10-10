import { createTemporalClient } from "#client";
import { reportFreshnessState } from "#observability/metrics-report.ts";
import {
  ReportDeliveryReceiptV1Schema,
  reportReceiptKey,
  reportReceiptPrefix,
} from "./report-delivery.ts";
import { readJson, reportReceiptStore } from "./report-object-store.ts";
import { inspectReportHeartbeat } from "./report-heartbeat-index.ts";
import {
  REPORT_SCHEDULE_REGISTRY,
  type ReportScheduleRegistration,
} from "#shared/reports/report-registry.ts";
import { isDynamicAgentTaskSchedule } from "#schedules/orphan-detection.ts";
import {
  SkippedNotificationSchema,
  skippedNotificationPrefix,
  usesDailyNotificationPolicy,
} from "./report-notification-policy.ts";

export type ReportFreshnessStatus =
  | "fresh"
  | "pending"
  | "indexing"
  | "stale"
  | "missing"
  | "schedule-missing"
  | "schedule-paused"
  | "unregistered";

export type ReportFreshnessResult = {
  scheduleId: string;
  status: ReportFreshnessStatus;
  acceptedAt: string | undefined;
  ageHours: number | undefined;
  maximumAgeHours: number | undefined;
  notificationSkippedAt?: string;
  heartbeatAt?: string | undefined;
};

function incompleteHistoryStatus(
  status: "stale" | "missing",
  historyComplete: boolean | undefined,
): "stale" | "missing" | "indexing" {
  return historyComplete === false ? "indexing" : status;
}

export function freshnessDeploymentState(input: {
  scheduleId: string;
  createdAt: Date | undefined;
  paused: boolean;
  memo: Record<string, unknown> | undefined;
  recentActions?: readonly { takenAt: Date }[];
}): {
  scheduleCreatedAt: string | undefined;
  paused: boolean;
  dynamic: boolean;
  lastActionTakenAt: string | undefined;
} {
  const latestAction = input.recentActions?.reduce<Date | undefined>(
    (latest, action) =>
      latest === undefined || action.takenAt > latest ? action.takenAt : latest,
    undefined,
  );
  return {
    scheduleCreatedAt: input.createdAt?.toISOString(),
    paused: input.paused,
    dynamic: isDynamicAgentTaskSchedule(input.scheduleId, input.memo),
    lastActionTakenAt: latestAction?.toISOString(),
  };
}

export function evaluateFreshness(input: {
  registration: ReportScheduleRegistration;
  now: Date;
  acceptedAt: string | undefined;
  notificationSkippedAt?: string;
  lastActionTakenAt: string | undefined;
  scheduleCreatedAt: string | undefined;
  deployed: boolean;
  paused: boolean;
  historyComplete?: boolean;
}): ReportFreshnessResult {
  const heartbeatAt = latestReportHeartbeat(input);
  const maximumAgeHours =
    input.registration.cadenceHours + input.registration.graceHours;
  if (!input.deployed)
    return {
      scheduleId: input.registration.scheduleId,
      status: "schedule-missing",
      acceptedAt: input.acceptedAt,
      ageHours: undefined,
      maximumAgeHours,
    };
  const scheduleCreatedAt = Date.parse(input.scheduleCreatedAt ?? "");
  if (!Number.isFinite(scheduleCreatedAt))
    throw new TypeError(
      `Schedule ${input.registration.scheduleId} has an unparseable scheduleCreatedAt: ${input.scheduleCreatedAt ?? "missing"}`,
    );
  if (input.paused)
    return {
      scheduleId: input.registration.scheduleId,
      status: "schedule-paused",
      acceptedAt: input.acceptedAt,
      ageHours: undefined,
      maximumAgeHours,
    };
  const receiptRequiredAfter = Date.parse(
    input.registration.receiptRequiredAfter,
  );
  if (!Number.isFinite(receiptRequiredAfter))
    throw new TypeError(
      `Schedule ${input.registration.scheduleId} has an unparseable receiptRequiredAfter: ${input.registration.receiptRequiredAfter}`,
    );
  const effectiveActivation = Math.max(receiptRequiredAfter, scheduleCreatedAt);
  const lastActionTakenAt =
    input.lastActionTakenAt === undefined
      ? undefined
      : Date.parse(input.lastActionTakenAt);
  if (
    heartbeatAt === undefined ||
    Date.parse(heartbeatAt) < effectiveActivation
  ) {
    // A schedule that never runs after activation would otherwise sit at
    // `pending` forever, which the alert deliberately does not page on. Bound
    // that window by one full cadence plus grace measured from activation.
    const graceDeadline =
      lastActionTakenAt === undefined || lastActionTakenAt < effectiveActivation
        ? effectiveActivation + maximumAgeHours * 3_600_000
        : lastActionTakenAt + input.registration.graceHours * 3_600_000;
    return {
      scheduleId: input.registration.scheduleId,
      status:
        input.now.getTime() <= graceDeadline
          ? "pending"
          : incompleteHistoryStatus("missing", input.historyComplete),
      acceptedAt: input.acceptedAt,
      ageHours: undefined,
      maximumAgeHours,
      ...(input.notificationSkippedAt === undefined
        ? {}
        : {
            notificationSkippedAt: input.notificationSkippedAt,
            heartbeatAt,
          }),
    };
  }
  const ageHours = (input.now.getTime() - Date.parse(heartbeatAt)) / 3_600_000;
  return {
    scheduleId: input.registration.scheduleId,
    status:
      ageHours <= maximumAgeHours
        ? "fresh"
        : incompleteHistoryStatus("stale", input.historyComplete),
    acceptedAt: input.acceptedAt,
    ageHours,
    maximumAgeHours,
    ...(input.notificationSkippedAt === undefined
      ? {}
      : {
          notificationSkippedAt: input.notificationSkippedAt,
          heartbeatAt,
        }),
  };
}

function latestReportHeartbeat(input: {
  acceptedAt: string | undefined;
  notificationSkippedAt?: string;
}): string | undefined {
  const times = [input.acceptedAt, input.notificationSkippedAt].flatMap(
    (value) => (value === undefined ? [] : [value]),
  );
  for (const time of times) {
    if (!Number.isFinite(Date.parse(time)))
      throw new TypeError("Invalid report heartbeat timestamp");
  }
  return times.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export function publishReportFreshnessMetrics(
  results: ReportFreshnessResult[],
): void {
  // prom-client retains labeled gauge series until explicitly removed. Reset
  // the scan-owned gauge so deleted dynamic schedules cannot remain alerting
  // after they disappear from both Temporal and this run's result set.
  reportFreshnessState.reset();
  for (const result of results) {
    reportFreshnessState.set(
      { temporal_namespace: "prod", schedule_id: result.scheduleId },
      result.status === "fresh"
        ? 1
        : result.status === "pending" || result.status === "indexing"
          ? 2
          : result.status === "stale" || result.status === "missing"
            ? 0
            : -1,
    );
  }
}

async function latestAcceptedAt(
  storage: ReturnType<typeof reportReceiptStore>,
  registration: ReportScheduleRegistration,
): Promise<{ timestamp: string | undefined; complete: boolean }> {
  const prefix = reportReceiptPrefix(registration, storage.prefix);
  return inspectReportHeartbeat(storage, prefix, async (key) => {
    const stored = await readJson(storage, key, ReportDeliveryReceiptV1Schema);
    const receipt = stored?.value;
    if (
      receipt?.reportType !== registration.reportType ||
      receipt.scheduleId !== registration.scheduleId ||
      reportReceiptKey(receipt, storage.prefix) !== key
    )
      throw new Error(`Report receipt does not match its family: ${key}`);
    return receipt.acceptedAt;
  });
}

async function latestSkippedAt(
  storage: ReturnType<typeof reportReceiptStore>,
  registration: ReportScheduleRegistration,
): Promise<{ timestamp: string | undefined; complete: boolean }> {
  if (!usesDailyNotificationPolicy(registration))
    return { timestamp: undefined, complete: true };
  return inspectReportHeartbeat(
    storage,
    skippedNotificationPrefix(registration),
    async (key) => {
      const stored = await readJson(storage, key, SkippedNotificationSchema);
      const skipped = stored?.value;
      if (
        skipped?.reportType !== registration.reportType ||
        skipped.scheduleId !== registration.scheduleId
      )
        throw new Error(
          `Skipped notification does not match its family: ${key}`,
        );
      return skipped.completedAt;
    },
  );
}

export async function inspectReportFreshness(): Promise<
  ReportFreshnessResult[]
> {
  const client = await createTemporalClient();
  const deployed = new Map<
    string,
    {
      scheduleCreatedAt: string | undefined;
      paused: boolean;
      dynamic: boolean;
      lastActionTakenAt: string | undefined;
    }
  >();
  const registeredIds = new Set(
    REPORT_SCHEDULE_REGISTRY.map((entry) => entry.scheduleId),
  );
  for await (const schedule of client.schedule.list()) {
    const description = registeredIds.has(schedule.scheduleId)
      ? await client.schedule.getHandle(schedule.scheduleId).describe()
      : undefined;
    deployed.set(
      schedule.scheduleId,
      freshnessDeploymentState({
        scheduleId: schedule.scheduleId,
        createdAt: description?.info.createdAt,
        memo: schedule.memo,
        paused: schedule.state.paused,
        recentActions: schedule.info.recentActions,
      }),
    );
  }
  const storage = reportReceiptStore();
  const now = new Date();
  const results = await Promise.all(
    REPORT_SCHEDULE_REGISTRY.map(async (registration) => {
      const live = deployed.get(registration.scheduleId);
      const [accepted, skipped] = await Promise.all([
        latestAcceptedAt(storage, registration),
        latestSkippedAt(storage, registration),
      ]);
      return evaluateFreshness({
        registration,
        now,
        acceptedAt: accepted.timestamp,
        historyComplete: accepted.complete && skipped.complete,
        ...(skipped.timestamp === undefined
          ? {}
          : { notificationSkippedAt: skipped.timestamp }),
        lastActionTakenAt: live?.lastActionTakenAt,
        scheduleCreatedAt: live?.scheduleCreatedAt,
        deployed: live !== undefined,
        paused: live?.paused === true,
      });
    }),
  );
  for (const [scheduleId, live] of deployed) {
    if (live.dynamic && !registeredIds.has(scheduleId)) {
      results.push({
        scheduleId,
        status: "unregistered",
        acceptedAt: undefined,
        ageHours: undefined,
        maximumAgeHours: undefined,
      });
    }
  }
  publishReportFreshnessMetrics(results);
  return results;
}

export const reportFreshnessActivities = { inspectReportFreshness };
export type ReportFreshnessActivities = typeof reportFreshnessActivities;
