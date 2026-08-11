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
  assertReportSendStillOwned,
  claimReportSend,
  reportSendAbortSignal,
  reportSendClaimKey,
  ReportSendClaimV1Schema,
  type ReportSendClaimBackend,
} from "./report-delivery-lease.ts";
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

export const ReportDeliveryResultSchema = ReportDeliveryReceiptV1Schema.extend({
  receiptKey: z.string().min(1),
  deduplicated: z.boolean(),
});

export type ReportDeliveryResult = z.infer<typeof ReportDeliveryResultSchema>;

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
} & ReportSendClaimBackend;

export type ReportDeliveryDependencies = {
  backend: ReportDeliveryBackend;
  addresses: { recipient: string; sender: string };
  send: (input: PostalSendInput) => Promise<PostalSendResult>;
  now: () => string;
  /** Identity of this delivery attempt; holder of the send lease. */
  owner: string;
  /**
   * Start of this activity attempt, captured before any I/O. The send lease is
   * both stamped and aged against this clock so slow pre-claim reads cannot
   * backdate a lease relative to the attempt that holds it.
   */
  attemptStartedAt: string;
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

function isMissingObject(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404)
  );
}

async function readJson<T>(
  store: ReportReceiptStore,
  key: string,
  schema: z.ZodType<T>,
): Promise<{ value: T; etag: string } | undefined> {
  try {
    const response = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: key }),
    );
    if (response.Body === undefined || response.ETag === undefined) {
      throw new Error(`Report object ${key} has no body or entity tag`);
    }
    return {
      value: schema.parse(JSON.parse(await response.Body.transformToString())),
      etag: response.ETag,
    };
  } catch (error: unknown) {
    if (isMissingObject(error)) return undefined;
    throw error;
  }
}

async function writeJson(
  store: ReportReceiptStore,
  key: string,
  value: unknown,
  condition?: { expectedEtag: string | undefined },
): Promise<void> {
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json; charset=utf-8",
      ...(condition === undefined
        ? {}
        : condition.expectedEtag === undefined
          ? { IfNoneMatch: "*" }
          : { IfMatch: condition.expectedEtag }),
    }),
  );
}

function deliveryBackend(store: ReportReceiptStore): ReportDeliveryBackend {
  return {
    readReceipt: async (key) => {
      const stored = await readJson(store, key, ReportDeliveryReceiptV1Schema);
      return stored?.value;
    },
    writeReceipt: (key, receipt) => writeJson(store, key, receipt),
    readState: async (key) => {
      const stored = await readJson(store, key, ReportStateV1Schema);
      return stored?.value;
    },
    writeState: (key, state) =>
      writeJson(store, key, ReportStateV1Schema.parse(state)),
    readSendClaim: async (key) => {
      const held = await readJson(store, key, ReportSendClaimV1Schema);
      return held === undefined
        ? undefined
        : { claim: held.value, etag: held.etag };
    },
    writeSendClaim: async (key, claim, expectedEtag) => {
      try {
        await writeJson(store, key, ReportSendClaimV1Schema.parse(claim), {
          expectedEtag,
        });
        return true;
      } catch (error: unknown) {
        // 412 is the conditional-write rejection; 409 is what S3 returns when
        // two conditional writes race. Both mean another attempt owns the send,
        // which is a normal outcome here rather than a storage failure.
        if (
          error instanceof S3ServiceException &&
          (error.$metadata.httpStatusCode === 412 ||
            error.$metadata.httpStatusCode === 409)
        ) {
          return false;
        }
        throw error;
      }
    },
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

export function activityReportRunId(
  reportType: string,
  runId: string,
  execution: ReportEnvelopeV1["execution"],
): string {
  const base = `${reportType}:${runId}`;
  return execution === "failed" ? `${base}:failed` : base;
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
    reportRunId: activityReportRunId(
      input.reportType,
      execution.runId,
      input.execution,
    ),
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
  // Captured before any I/O so it is the attempt's own start, which is the
  // single clock the send lease is stamped and aged against.
  const attemptStartedAt = new Date().toISOString();
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  const store = reportReceiptStore();
  const info = Context.current().info;
  const execution = info.workflowExecution;
  if (execution === undefined) {
    throw new Error("Report delivery requires a Temporal workflow execution");
  }
  return deliverReportWithDependencies(report, {
    backend: deliveryBackend(store),
    addresses: resolvePostalAddresses(),
    send: (input) => sendPostalEmail(input),
    now: () => new Date().toISOString(),
    // Per-attempt, so a retry never mistakes a previous attempt's lease for its
    // own and every takeover is attributable.
    owner: `${execution.workflowId}/${execution.runId}/${info.activityId}/${String(info.attempt)}`,
    attemptStartedAt,
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

  // A `pending` state is not proof the email was not sent: Temporal can start a
  // new attempt once start-to-close elapses, while the previous attempt is
  // between `send` and its state write. Treating pending as "not sent" would
  // resend; treating it as "sent" would silently drop a report whose owner died
  // before sending. Take exclusive ownership of the send instead, with a lease
  // longer than any attempt Temporal will still accept a completion from.
  const owned = await claimReportSend({
    backend: dependencies.backend,
    claimKey: reportSendClaimKey(stateKey),
    reportRunId: report.reportRunId,
    owner: dependencies.owner,
    attemptStartedAt: dependencies.attemptStartedAt,
  });
  if (!owned) {
    reportDeliveryTotal.inc({ ...metricLabels(report), outcome: "contended" });
    throw new Error(
      `Report ${report.reportRunId} is already being delivered by another attempt; retry after the current owner persists its receipt`,
    );
  }
  // The owner we displaced may have completed between our reads and the
  // takeover, so re-check before spending a second send.
  const settled = await dependencies.backend.readReceipt(receiptKey);
  if (settled !== undefined) {
    reportDeliveryTotal.inc({
      ...metricLabels(report),
      outcome: "deduplicated",
    });
    recordAccepted(report, settled.acceptedAt);
    return { ...settled, receiptKey, deduplicated: true };
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
      // Armed here, after the state write, so the request cannot outlive the
      // lease by however long that write took. Temporal's start-to-close
      // abandons the attempt's result but never aborts an in-flight fetch, so
      // without this a replaced owner could still deliver a second copy after
      // the takeover already sent. Keep this call inside the send arguments —
      // measuring earlier and arming here is the bug it replaced.
      signal: reportSendAbortSignal({
        reportRunId: report.reportRunId,
        attemptStartedAt: dependencies.attemptStartedAt,
        now: dependencies.now(),
      }),
    });
    // The message is accepted, but recording it happens after the send and can
    // outlast the lease. If a successor took over meanwhile it owns the
    // durable record, so stop rather than overwrite it with this attempt's
    // state and receipt.
    await assertReportSendStillOwned({
      backend: dependencies.backend,
      claimKey: reportSendClaimKey(stateKey),
      reportRunId: report.reportRunId,
      owner: dependencies.owner,
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
