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
} from "#shared/report-registry.ts";
import { isDynamicAgentTaskSchedule } from "#schedules/orphan-detection.ts";

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
};

export function freshnessDeploymentState(input: {
  scheduleId: string;
  paused: boolean;
  memo: Record<string, unknown> | undefined;
  recentActions?: readonly { takenAt: Date }[];
}): {
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
    bucket:
      Bun.env["REPORT_RECEIPT_BUCKET"] ??
      Bun.env["REVIEW_SIGNAL_ARCHIVE_BUCKET"] ??
      "llm-archive",
    prefix: Bun.env["REPORT_RECEIPT_PREFIX"] ?? "reports/receipts",
  };
}

export function evaluateFreshness(input: {
  registration: ReportScheduleRegistration;
  now: Date;
  acceptedAt: string | undefined;
  lastActionTakenAt: string | undefined;
  deployed: boolean;
  paused: boolean;
}): ReportFreshnessResult {
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
    throw new Error(
      `Schedule ${input.registration.scheduleId} has an unparseable receiptRequiredAfter: ${input.registration.receiptRequiredAfter}`,
    );
  const lastActionTakenAt =
    input.lastActionTakenAt === undefined
      ? undefined
      : Date.parse(input.lastActionTakenAt);
  if (
    input.acceptedAt === undefined ||
    Date.parse(input.acceptedAt) < receiptRequiredAfter
  ) {
    // A schedule that never runs after activation would otherwise sit at
    // `pending` forever, which the alert deliberately does not page on. Bound
    // that window by one full cadence plus grace measured from activation.
    const graceDeadline =
      lastActionTakenAt === undefined ||
      lastActionTakenAt < receiptRequiredAfter
        ? receiptRequiredAfter + maximumAgeHours * 3_600_000
        : lastActionTakenAt + input.registration.graceHours * 3_600_000;
    return {
      scheduleId: input.registration.scheduleId,
      status: input.now.getTime() <= graceDeadline ? "pending" : "missing",
      acceptedAt: input.acceptedAt,
      ageHours: undefined,
      maximumAgeHours,
    };
  }
  const ageHours =
    (input.now.getTime() - Date.parse(input.acceptedAt)) / 3_600_000;
  return {
    scheduleId: input.registration.scheduleId,
    status: ageHours > maximumAgeHours ? "stale" : "fresh",
    acceptedAt: input.acceptedAt,
    ageHours,
    maximumAgeHours,
  };
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
      { schedule_id: result.scheduleId },
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

async function latestAcceptedAt(
  storage: ReturnType<typeof store>,
  registration: ReportScheduleRegistration,
): Promise<string | undefined> {
  const prefix = reportReceiptPrefix(
    {
      reportType: registration.reportType,
      scheduleId: registration.scheduleId,
    },
    storage.prefix,
  );
  let continuationToken: string | undefined;
  let latest:
    | { Key?: string | undefined; LastModified?: Date | undefined }
    | undefined;
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
      if (
        (latest === undefined ||
          (object.LastModified?.getTime() ?? 0) >
            (latest.LastModified?.getTime() ?? 0)) &&
        object.Key !== undefined
      ) {
        latest = object;
      }
    }
    continuationToken =
      listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
    if (continuationToken === undefined && listed.IsTruncated === true) {
      throw new Error(
        `S3 truncated receipt listing for ${prefix} without a continuation token`,
      );
    }
  } while (continuationToken !== undefined);
  if (latest?.Key === undefined) return undefined;
  const object = await storage.client.send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: latest.Key }),
  );
  if (object.Body === undefined)
    throw new Error(`Report receipt ${latest.Key} has no body`);
  return ReportDeliveryReceiptV1Schema.parse(
    JSON.parse(await object.Body.transformToString()),
  ).acceptedAt;
}

export async function inspectReportFreshness(): Promise<
  ReportFreshnessResult[]
> {
  const client = await createTemporalClient();
  const deployed = new Map<
    string,
    {
      paused: boolean;
      dynamic: boolean;
      lastActionTakenAt: string | undefined;
    }
  >();
  for await (const schedule of client.schedule.list()) {
    deployed.set(
      schedule.scheduleId,
      freshnessDeploymentState({
        scheduleId: schedule.scheduleId,
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
      return evaluateFreshness({
        registration,
        now,
        acceptedAt: await latestAcceptedAt(storage, registration),
        lastActionTakenAt: live?.lastActionTakenAt,
        deployed: live !== undefined,
        paused: live?.paused === true,
      });
    }),
  );
  const registeredIds = new Set(
    REPORT_SCHEDULE_REGISTRY.map((entry) => entry.scheduleId),
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
