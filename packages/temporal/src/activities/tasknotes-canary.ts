import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import { runCommand } from "./data-dragon-shell.ts";
import { ReportStateV1Schema } from "./report-delivery.ts";

const EngineStatusSchema = z.object({
  success: z.literal(true),
  data: z.object({
    configSource: z.string(),
    tasks: z.number().int().nonnegative(),
    skippedFiles: z.array(
      z.object({ path: z.string().min(1), reason: z.string().min(1) }),
    ),
  }),
});
const PodListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string(), namespace: z.string() }),
      status: z.object({
        phase: z.string(),
        containerStatuses: z
          .array(
            z.object({
              name: z.string(),
              ready: z.boolean(),
              restartCount: z.number().int().nonnegative(),
            }),
          )
          .default([]),
      }),
    }),
  ),
});
const BaselineSchema = z.object({
  schemaVersion: z.literal(1),
  tasks: z.number().int().nonnegative(),
  acceptedAt: z.iso.datetime({ offset: true }),
  reportRunId: z.string().min(1),
});
const BaselineEvidenceSchema = z.object({
  tasks: z.number().int().nonnegative(),
});

type EngineStatus = z.infer<typeof EngineStatusSchema>["data"];
type TasknotesBaseline = z.infer<typeof BaselineSchema>;
type Pod = z.infer<typeof PodListSchema>["items"][number];

export type TasknotesCanaryResult = {
  observedAt: string;
  engine: EngineStatus;
  pods: Pod[];
  baseline: TasknotesBaseline | undefined;
  evidence: { pods: string; baseline: string | undefined };
};

type Store = { client: S3Client; bucket: string; prefix: string };

function canAdvanceTasknotesBaseline(
  state: z.infer<typeof ReportStateV1Schema>,
): boolean {
  const report = state.report;
  if (report.execution === "complete" && report.verdict === "clear") {
    return true;
  }
  const taskCount = report.checks.find((check) => check.id === "task-count");
  const otherRequiredChecksPassed = report.checks
    .filter((check) => check.id !== "task-count" && check.required)
    .every((check) => check.status === "passed");
  return (
    report.execution === "partial" &&
    report.verdict === "inconclusive" &&
    taskCount?.required === true &&
    taskCount.status === "skipped" &&
    otherRequiredChecksPassed &&
    report.findings.length === 0
  );
}

export function tasknotesBaselineFromReportState(
  state: z.infer<typeof ReportStateV1Schema>,
): TasknotesBaseline | undefined {
  if (state.delivery.status !== "accepted") return undefined;
  if (
    state.report.reportType !== "tasknotes-canary" ||
    state.report.scheduleId !== "tasknotes-skipped-files-canary"
  ) {
    throw new Error(
      `TaskNotes baseline prefix contains report ${state.report.reportRunId} with the wrong identity`,
    );
  }
  if (!canAdvanceTasknotesBaseline(state)) return undefined;
  const engineEvidence = state.report.evidence.find(
    (evidence) => evidence.id === "engine-status",
  );
  if (engineEvidence?.excerpt === undefined) {
    throw new Error(
      `Baseline-eligible TaskNotes report ${state.report.reportRunId} lacks engine-status evidence`,
    );
  }
  const tasks = BaselineEvidenceSchema.parse(
    JSON.parse(engineEvidence.excerpt),
  ).tasks;
  return BaselineSchema.parse({
    schemaVersion: 1,
    tasks,
    acceptedAt: state.delivery.receipt.acceptedAt,
    reportRunId: state.report.reportRunId,
  });
}

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is required`);
  return value;
}

function baselineStore(): Store {
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
    prefix: `${Bun.env["REPORT_STATE_PREFIX"] ?? "reports/state"}/tasknotes-canary/tasknotes-skipped-files-canary/`,
  };
}

async function readBaseline(store: Store): Promise<{
  value: TasknotesBaseline | undefined;
  raw: string | undefined;
}> {
  const objects: { key: string; modifiedAt: number }[] = [];
  try {
    let continuationToken: string | undefined;
    do {
      const listed = await store.client.send(
        new ListObjectsV2Command({
          Bucket: store.bucket,
          Prefix: store.prefix,
          ...(continuationToken === undefined
            ? {}
            : { ContinuationToken: continuationToken }),
        }),
      );
      for (const object of listed.Contents ?? []) {
        if (object.Key !== undefined) {
          objects.push({
            key: object.Key,
            modifiedAt: object.LastModified?.getTime() ?? 0,
          });
        }
      }
      continuationToken =
        listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
      if (continuationToken === undefined && listed.IsTruncated === true) {
        throw new Error(
          `S3 truncated TaskNotes state listing for ${store.prefix} without a continuation token`,
        );
      }
    } while (continuationToken !== undefined);
    for (const object of objects.toSorted(
      (left, right) => right.modifiedAt - left.modifiedAt,
    )) {
      const response = await store.client.send(
        new GetObjectCommand({ Bucket: store.bucket, Key: object.key }),
      );
      if (response.Body === undefined) {
        throw new Error(`TaskNotes report state ${object.key} has no body`);
      }
      const raw = await response.Body.transformToString();
      const state = ReportStateV1Schema.parse(JSON.parse(raw));
      const value = tasknotesBaselineFromReportState(state);
      if (value === undefined) continue;
      return {
        value,
        raw,
      };
    }
    return { value: undefined, raw: undefined };
  } catch (error) {
    if (
      error instanceof NoSuchKey ||
      (error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404)
    ) {
      return { value: undefined, raw: undefined };
    }
    throw error;
  }
}

const ENGINE_STATUS_SCRIPT = [
  "const token = process.env.AUTH_TOKEN;",
  'if (!token) throw new Error("AUTH_TOKEN missing");',
  'const response = await fetch("http://localhost:3000/api/engine-status", {',
  '  headers: { Authorization: "Bearer " + token },',
  "});",
  'if (!response.ok) throw new Error("engine-status HTTP " + response.status);',
  "console.log(await response.text());",
].join("\n");

export async function collectTasknotesCanary(): Promise<TasknotesCanaryResult> {
  const [engineRaw, podsRaw, baseline] = await Promise.all([
    runCommand(
      [
        "kubectl",
        "exec",
        "-n",
        "tasknotes",
        "deploy/tasknotes",
        "-c",
        "tasknotes-server",
        "--",
        "bun",
        "-e",
        ENGINE_STATUS_SCRIPT,
      ],
      { cwd: "/tmp" },
    ),
    runCommand(["kubectl", "get", "pods", "-n", "tasknotes", "-o", "json"], {
      cwd: "/tmp",
    }),
    readBaseline(baselineStore()),
  ]);
  return {
    observedAt: new Date().toISOString(),
    engine: EngineStatusSchema.parse(JSON.parse(engineRaw)).data,
    pods: PodListSchema.parse(JSON.parse(podsRaw)).items,
    baseline: baseline.value,
    evidence: {
      pods: podsRaw,
      baseline:
        baseline.value === undefined
          ? undefined
          : JSON.stringify(baseline.value),
    },
  };
}

export const tasknotesCanaryActivities = {
  collectTasknotesCanary,
};
export type TasknotesCanaryActivities = typeof tasknotesCanaryActivities;
