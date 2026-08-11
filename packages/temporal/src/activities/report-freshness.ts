import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createTemporalClient } from "#client";
import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
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
}): { paused: boolean; dynamic: boolean } {
  return {
    paused: input.paused,
    dynamic: isDynamicAgentTaskSchedule(input.scheduleId, input.memo),
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
  if (input.acceptedAt === undefined)
    return {
      scheduleId: input.registration.scheduleId,
      status: "missing",
      acceptedAt: undefined,
      ageHours: undefined,
      maximumAgeHours,
    };
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
  const deployed = new Map<string, { paused: boolean; dynamic: boolean }>();
  for await (const schedule of client.schedule.list()) {
    deployed.set(
      schedule.scheduleId,
      freshnessDeploymentState({
        scheduleId: schedule.scheduleId,
        memo: schedule.memo,
        paused: schedule.state.paused,
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
  const poster = createAlertmanagerPoster(requiredEnv("ALERTMANAGER_URL"));
  await poster(
    results.map((result) => ({
      labels: {
        alertname: "TemporalReportHeartbeatStale",
        severity: "warning",
        schedule_id: result.scheduleId,
      },
      annotations: {
        summary: `Temporal report heartbeat ${result.status}: ${result.scheduleId}`,
        description: `status=${result.status}; acceptedAt=${result.acceptedAt ?? "none"}; ageHours=${result.ageHours?.toFixed(2) ?? "unknown"}; maximumAgeHours=${result.maximumAgeHours?.toString() ?? "unknown"}`,
      },
      startsAt: now.toISOString(),
      endsAt: new Date(
        now.getTime() + (result.status === "fresh" ? 0 : 60 * 60 * 1000),
      ).toISOString(),
    })),
  );
  return results;
}

export const reportFreshnessActivities = { inspectReportFreshness };
export type ReportFreshnessActivities = typeof reportFreshnessActivities;
