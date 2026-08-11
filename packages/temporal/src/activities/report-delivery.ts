import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import {
  reportDeliveryTotal,
  reportLastAcceptedTimestampSeconds,
} from "#observability/metrics-report.ts";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";
import type { PostalSendInput, PostalSendResult } from "#shared/postal.ts";
import {
  renderReportHtml,
  renderReportText,
  ReportEnvelopeV1Schema,
  reportSubject,
  type ReportEnvelopeV1,
} from "#shared/report.ts";
import { temporalUiExecutionUrl } from "#shared/workflow-failure-alert.ts";

export const ReportDeliveryReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  reportRunId: z.string().min(1),
  reportType: z.string().min(1),
  scheduleId: z.string().min(1).optional(),
  subject: z.string().min(1),
  messageId: z.string().min(1),
  recipientId: z.union([z.number().int(), z.literal("unknown")]),
  acceptedAt: z.iso.datetime({ offset: true }),
  reportStateKey: z.string().min(1),
});

export type ReportDeliveryReceiptV1 = z.infer<
  typeof ReportDeliveryReceiptV1Schema
>;

export type ReportDeliveryResult = ReportDeliveryReceiptV1 & {
  receiptKey: string;
  deduplicated: boolean;
};

export type ReportDeliveryActivities = typeof reportDeliveryActivities;

export const ReportStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  report: ReportEnvelopeV1Schema,
  delivery: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("pending"),
      updatedAt: z.iso.datetime({ offset: true }),
    }),
    z.object({
      status: z.literal("accepted"),
      updatedAt: z.iso.datetime({ offset: true }),
      receipt: ReportDeliveryReceiptV1Schema,
    }),
  ]),
});

export type ReportStateV1 = z.infer<typeof ReportStateV1Schema>;

export type ReportDeliveryBackend = {
  readReceipt: (key: string) => Promise<ReportDeliveryReceiptV1 | undefined>;
  writeReceipt: (
    key: string,
    receipt: ReportDeliveryReceiptV1,
  ) => Promise<void>;
  readState: (key: string) => Promise<ReportStateV1 | undefined>;
  writeState: (key: string, state: ReportStateV1) => Promise<void>;
};

export type ReportDeliveryDependencies = {
  backend: ReportDeliveryBackend;
  addresses: { recipient: string; sender: string };
  send: (input: PostalSendInput) => Promise<PostalSendResult>;
  now: () => string;
  receiptPrefix?: string;
  statePrefix?: string;
};

export type ActivityReportInput = Omit<
  ReportEnvelopeV1,
  "schemaVersion" | "reportRunId" | "completedAt" | "provenance"
> & {
  provenance?: Omit<ReportEnvelopeV1["provenance"], "workflowId" | "runId">;
};

type ReportReceiptStore = {
  client: S3Client;
  bucket: string;
  prefix: string;
};

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for report receipt storage`);
  }
  return value;
}

function reportReceiptStore(): ReportReceiptStore {
  const accessKeyId = requiredEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("AWS_SECRET_ACCESS_KEY");
  const sessionToken = Bun.env["AWS_SESSION_TOKEN"];
  const credentials =
    sessionToken === undefined || sessionToken === ""
      ? { accessKeyId, secretAccessKey }
      : { accessKeyId, secretAccessKey, sessionToken };
  return {
    client: new S3Client({
      endpoint: requiredEnv("S3_ENDPOINT"),
      region: Bun.env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
      credentials,
    }),
    bucket:
      Bun.env["REPORT_RECEIPT_BUCKET"] ??
      Bun.env["REVIEW_SIGNAL_ARCHIVE_BUCKET"] ??
      "llm-archive",
    prefix: Bun.env["REPORT_RECEIPT_PREFIX"] ?? "reports/receipts",
  };
}

function safeKeyPart(value: string): string {
  return value.replaceAll(/[^\w.=-]+/g, "-");
}

export function reportReceiptKey(
  report: Pick<ReportEnvelopeV1, "reportRunId" | "reportType" | "scheduleId">,
  prefix = "reports/receipts",
): string {
  const schedule = report.scheduleId ?? "manual";
  return `${prefix}/${safeKeyPart(report.reportType)}/${safeKeyPart(schedule)}/${safeKeyPart(report.reportRunId)}.json`;
}

export function reportReceiptPrefix(
  report: Pick<ReportEnvelopeV1, "reportType" | "scheduleId"> & {
    scheduleId: string;
  },
  prefix = "reports/receipts",
): string {
  return `${prefix}/${safeKeyPart(report.reportType)}/${safeKeyPart(report.scheduleId)}/`;
}

export function reportStateKey(
  report: Pick<ReportEnvelopeV1, "reportRunId" | "reportType" | "scheduleId">,
  prefix = "reports/state",
): string {
  const schedule = report.scheduleId ?? "manual";
  return `${prefix}/${safeKeyPart(report.reportType)}/${safeKeyPart(schedule)}/${safeKeyPart(report.reportRunId)}.json`;
}

async function readReceipt(
  store: ReportReceiptStore,
  key: string,
): Promise<ReportDeliveryReceiptV1 | undefined> {
  try {
    const response = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: key }),
    );
    if (response.Body === undefined) {
      throw new Error(`Report receipt ${key} has no body`);
    }
    return ReportDeliveryReceiptV1Schema.parse(
      JSON.parse(await response.Body.transformToString()),
    );
  } catch (error: unknown) {
    if (
      error instanceof NoSuchKey ||
      (error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404)
    ) {
      return undefined;
    }
    throw error;
  }
}

async function writeReceipt(
  store: ReportReceiptStore,
  key: string,
  receipt: ReportDeliveryReceiptV1,
): Promise<void> {
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: JSON.stringify(receipt, null, 2),
      ContentType: "application/json; charset=utf-8",
    }),
  );
}

async function readState(
  store: ReportReceiptStore,
  key: string,
): Promise<ReportStateV1 | undefined> {
  try {
    const response = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: key }),
    );
    if (response.Body === undefined) {
      throw new Error(`Report state ${key} has no body`);
    }
    return ReportStateV1Schema.parse(
      JSON.parse(await response.Body.transformToString()),
    );
  } catch (error: unknown) {
    if (
      error instanceof NoSuchKey ||
      (error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404)
    ) {
      return undefined;
    }
    throw error;
  }
}

async function writeState(
  store: ReportReceiptStore,
  key: string,
  state: ReportStateV1,
): Promise<void> {
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: JSON.stringify(ReportStateV1Schema.parse(state), null, 2),
      ContentType: "application/json; charset=utf-8",
    }),
  );
}

function deliveryBackend(store: ReportReceiptStore): ReportDeliveryBackend {
  return {
    readReceipt: (key) => readReceipt(store, key),
    writeReceipt: (key, receipt) => writeReceipt(store, key, receipt),
    readState: (key) => readState(store, key),
    writeState: (key, state) => writeState(store, key, state),
  };
}

function metricLabels(report: ReportEnvelopeV1) {
  return {
    report_type: report.reportType,
    execution: report.execution,
    verdict: report.verdict,
  };
}

function recordAccepted(report: ReportEnvelopeV1, acceptedAt: string): void {
  reportLastAcceptedTimestampSeconds.set(
    {
      report_type: report.reportType,
      schedule_id: report.scheduleId ?? "manual",
    },
    Date.parse(acceptedAt) / 1000,
  );
}

export function createActivityReportEnvelope(
  input: ActivityReportInput,
): ReportEnvelopeV1 {
  const info = Context.current().info;
  const execution = info.workflowExecution;
  if (execution === undefined) {
    throw new Error("Report delivery requires a Temporal workflow execution");
  }
  const baseProvenance = input.provenance ?? {};
  return ReportEnvelopeV1Schema.parse({
    ...input,
    schemaVersion: 1,
    reportRunId: `${input.reportType}:${execution.runId}`,
    completedAt: new Date().toISOString(),
    provenance: {
      ...baseProvenance,
      workflowId: execution.workflowId,
      runId: execution.runId,
      temporalUrl: temporalUiExecutionUrl(
        execution.workflowId,
        execution.runId,
      ),
    },
  });
}

export async function deliverReport(
  rawReport: ReportEnvelopeV1,
): Promise<ReportDeliveryResult> {
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  const store = reportReceiptStore();
  return deliverReportWithDependencies(report, {
    backend: deliveryBackend(store),
    addresses: resolvePostalAddresses(),
    send: (input) => sendPostalEmail(input),
    now: () => new Date().toISOString(),
    receiptPrefix: store.prefix,
    statePrefix: Bun.env["REPORT_STATE_PREFIX"] ?? "reports/state",
  });
}

export async function deliverReportWithDependencies(
  rawReport: ReportEnvelopeV1,
  dependencies: ReportDeliveryDependencies,
): Promise<ReportDeliveryResult> {
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  const receiptKey = reportReceiptKey(report, dependencies.receiptPrefix);
  const stateKey = reportStateKey(report, dependencies.statePrefix);
  const existing = await dependencies.backend.readReceipt(receiptKey);
  if (existing !== undefined) {
    reportDeliveryTotal.inc({
      ...metricLabels(report),
      outcome: "deduplicated",
    });
    recordAccepted(report, existing.acceptedAt);
    return { ...existing, receiptKey, deduplicated: true };
  }

  const existingState = await dependencies.backend.readState(stateKey);
  if (existingState?.delivery.status === "accepted") {
    const receipt = existingState.delivery.receipt;
    await dependencies.backend.writeReceipt(receiptKey, receipt);
    reportDeliveryTotal.inc({
      ...metricLabels(report),
      outcome: "deduplicated",
    });
    recordAccepted(report, receipt.acceptedAt);
    return { ...receipt, receiptKey, deduplicated: true };
  }

  const { recipient, sender } = dependencies.addresses;
  const subject = reportSubject(report);
  try {
    await dependencies.backend.writeState(
      stateKey,
      ReportStateV1Schema.parse({
        schemaVersion: 1,
        report,
        delivery: { status: "pending", updatedAt: dependencies.now() },
      }),
    );
    const sent = await dependencies.send({
      to: recipient,
      from: sender,
      subject,
      htmlBody: renderReportHtml(report),
      plainBody: renderReportText(report),
      headers: {
        "X-Report-Run-ID": report.reportRunId,
        "X-Report-Type": report.reportType,
        "X-Temporal-Workflow-ID": report.provenance.workflowId,
        "X-Temporal-Run-ID": report.provenance.runId,
        ...(report.scheduleId === undefined
          ? {}
          : { "X-Report-Schedule-ID": report.scheduleId }),
      },
      tag: report.reportType,
    });
    const receipt = ReportDeliveryReceiptV1Schema.parse({
      schemaVersion: 1,
      reportRunId: report.reportRunId,
      reportType: report.reportType,
      scheduleId: report.scheduleId,
      subject,
      messageId: sent.messageId,
      recipientId: sent.recipientId,
      acceptedAt: dependencies.now(),
      reportStateKey: stateKey,
    });
    await dependencies.backend.writeState(
      stateKey,
      ReportStateV1Schema.parse({
        schemaVersion: 1,
        report,
        delivery: {
          status: "accepted",
          updatedAt: receipt.acceptedAt,
          receipt,
        },
      }),
    );
    await dependencies.backend.writeReceipt(receiptKey, receipt);
    reportDeliveryTotal.inc({ ...metricLabels(report), outcome: "accepted" });
    recordAccepted(report, receipt.acceptedAt);
    return { ...receipt, receiptKey, deduplicated: false };
  } catch (error: unknown) {
    reportDeliveryTotal.inc({ ...metricLabels(report), outcome: "failed" });
    throw error;
  }
}

export const reportDeliveryActivities = {
  deliverReport,
  async deliverActivityReport(
    input: ActivityReportInput,
  ): Promise<ReportDeliveryResult> {
    return deliverReport(createActivityReportEnvelope(input));
  },
};
