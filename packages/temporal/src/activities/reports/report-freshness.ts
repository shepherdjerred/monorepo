import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createTemporalClient } from "#client";
import { reportFreshnessState } from "#observability/metrics-report.ts";
import {
  ReportDeliveryReceiptV1Schema,
  reportReceiptPrefix,
} from "./report-delivery.ts";
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

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is required`);
  return value;
}

function store(): { client: S3Client; bucket: string; prefix: string } {
  const sessionToken = Bun.env["AWS_SESSION_TOKEN"];
  return {
    client: new S3Client({
      endpoint: requiredEnv("S3_ENDPOINT"),
      region: Bun.env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
      credentials: {
        accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
        ...(sessionToken === undefined || sessionToken === ""
          ? {}
          : { sessionToken }),
      },
    }),
    bucket: Bun.env["REPORT_RECEIPT_BUCKET"] ?? "llm-archive",
    prefix: Bun.env["REPORT_RECEIPT_PREFIX"] ?? "reports/receipts",
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
      status: input.now.getTime() <= graceDeadline ? "pending" : "missing",
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
    status: ageHours > maximumAgeHours ? "stale" : "fresh",
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
        : result.status === "pending"
          ? 2
          : result.status === "stale" || result.status === "missing"
            ? 0
            : -1,
    );
  }
}

async function* reportObjectKeys(
  storage: ReturnType<typeof store>,
  prefix: string,
): AsyncGenerator<string> {
  let continuationToken: string | undefined;
  do {
    const listed = await storage.client.send(
      new ListObjectsV2Command({
        Bucket: storage.bucket,
        Prefix: prefix,
        ...(continuationToken === undefined
          ? {}
          : { ContinuationToken: continuationToken }),
      }),
    );
    for (const object of listed.Contents ?? []) {
      if (object.Key !== undefined) yield object.Key;
    }
    continuationToken =
      listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
    if (continuationToken === undefined && listed.IsTruncated === true) {
      throw new Error(
        `S3 truncated report listing for ${prefix} without a continuation token`,
      );
    }
  } while (continuationToken !== undefined);
}

async function reportObjectText(
  storage: ReturnType<typeof store>,
  key: string,
): Promise<string> {
  const object = await storage.client.send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
  );
  if (object.Body === undefined)
    throw new Error(`Report object ${key} has no body`);
  return object.Body.transformToString();
}

async function latestAcceptedAt(
  storage: ReturnType<typeof store>,
  registration: ReportScheduleRegistration,
): Promise<string | undefined> {
  const prefix = reportReceiptPrefix(registration, storage.prefix);
  let latest: string | undefined;
  for await (const key of reportObjectKeys(storage, prefix)) {
    const text = await reportObjectText(storage, key);
    const receipt = ReportDeliveryReceiptV1Schema.parse(JSON.parse(text));
    // Restoring an old receipt gives it a new LastModified. Compare its actual
    // acceptance time so an old retry cannot mask newer accepted mail.
    latest = latestReportHeartbeat({
      acceptedAt: latest,
      notificationSkippedAt: receipt.acceptedAt,
    });
  }
  return latest;
}

async function latestSkippedAt(
  storage: ReturnType<typeof store>,
  registration: ReportScheduleRegistration,
): Promise<string | undefined> {
  if (!usesDailyNotificationPolicy(registration)) return undefined;
  let latestKey: string | undefined;
  for await (const key of reportObjectKeys(
    storage,
    skippedNotificationPrefix(registration),
  )) {
    if (latestKey === undefined || key > latestKey) latestKey = key;
  }
  if (latestKey === undefined) return undefined;
  const text = await reportObjectText(storage, latestKey);
  return SkippedNotificationSchema.parse(JSON.parse(text)).completedAt;
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
  const storage = store();
  const now = new Date();
  const results = await Promise.all(
    REPORT_SCHEDULE_REGISTRY.map(async (registration) => {
      const live = deployed.get(registration.scheduleId);
      const [acceptedAt, notificationSkippedAt] = await Promise.all([
        latestAcceptedAt(storage, registration),
        latestSkippedAt(storage, registration),
      ]);
      return evaluateFreshness({
        registration,
        now,
        acceptedAt,
        ...(notificationSkippedAt === undefined
          ? {}
          : { notificationSkippedAt }),
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
