import { Context } from "@temporalio/activity";
import {
  reportReceiptStore,
  readJson,
  writeJson,
  conditionalWrite,
  type ReportReceiptStore,
} from "./report-object-store.ts";
import { z } from "zod/v4";
import {
  reportDeliveryTotal,
  reportLastAcceptedTimestampSeconds,
} from "#observability/metrics-report.ts";
import { resolvePostalAddressesForReport } from "#config/postal.ts";
import {
  sendPostalEmail,
  type PostalSendInput,
  type PostalSendResult,
} from "#shared/infra/postal.ts";
import {
  assertReportSendStillOwned,
  claimReportSend,
  reportSendAbortSignal,
  reportSendClaimKey,
  s3ReportSendClaimBackend,
  type ReportSendClaimBackend,
} from "./report-delivery-lease.ts";
import { reportSubject } from "#shared/reports/report-presentation.ts";
import {
  renderReportHtml,
  renderReportText,
} from "#shared/reports/report-renderer.ts";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "#shared/reports/report.ts";
import { temporalUiExecutionUrl } from "#shared/alerts/workflow-failure-alert.ts";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { deliverEnvelopeWithDailyPolicy } from "./report-notification-store.ts";
import { recordReportHeartbeat } from "./report-heartbeat-index.ts";
import {
  pushSentReportReceiptToHub,
  tryPushReportRunToHub,
  type PushReportRunToHubFn,
} from "./report-hub-ingest.ts";
import type { SkippedNotification } from "./report-notification-policy.ts";

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
  ) => Promise<boolean>;
  readState: (key: string) => Promise<ReportStateV1 | undefined>;
  writeState: (key: string, state: ReportStateV1) => Promise<void>;
} & ReportSendClaimBackend;

export type ReportDeliveryDependencies = {
  backend: ReportDeliveryBackend;
  addresses: { recipient: string; sender: string };
  send: (input: PostalSendInput) => Promise<PostalSendResult>;
  now: () => string;
  owner: string;
  attemptStartedAt: string;
  receiptPrefix?: string;
  statePrefix?: string;
  pushToHub?: PushReportRunToHubFn;
};

export type ActivityReportInput = Omit<
  ReportEnvelopeV1,
  "schemaVersion" | "reportRunId" | "completedAt" | "provenance"
> & {
  provenance?: Omit<ReportEnvelopeV1["provenance"], "workflowId" | "runId">;
};

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

function deliveryBackend(store: ReportReceiptStore): ReportDeliveryBackend {
  return {
    readReceipt: async (key) => {
      const stored = await readJson(store, key, ReportDeliveryReceiptV1Schema);
      if (stored !== undefined)
        await recordReportHeartbeat(store, key, stored.value.acceptedAt);
      return stored?.value;
    },
    writeReceipt: async (key, receipt) => {
      const recorded = await conditionalWrite(() =>
        writeJson(store, key, receipt, { expectedEtag: undefined }),
      );
      if (recorded) await recordReportHeartbeat(store, key, receipt.acceptedAt);
      return recorded;
    },
    readState: async (key) => {
      const stored = await readJson(store, key, ReportStateV1Schema);
      return stored?.value;
    },
    writeState: (key, state) =>
      writeJson(store, key, ReportStateV1Schema.parse(state)),
    ...s3ReportSendClaimBackend(store),
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
      ...input.provenance,
      workflowId: execution.workflowId,
      runId: execution.runId,
      temporalUrl: temporalUiExecutionUrl(
        parseTemporalNamespace(info.namespace),
        execution.workflowId,
        execution.runId,
      ),
    },
  });
}

export async function deliverReport(
  rawReport: ReportEnvelopeV1,
): Promise<ReportDeliveryResult> {
  const attemptStartedAt = new Date().toISOString();
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  const deps = await activityDeliveryDependencies(
    reportReceiptStore(),
    attemptStartedAt,
    report.reportType,
  );
  return deliverReportWithDependencies(report, deps);
}

async function activityDeliveryDependencies(
  store: ReportReceiptStore,
  attemptStartedAt: string,
  reportType: string,
): Promise<ReportDeliveryDependencies> {
  const info = Context.current().info;
  const execution = info.workflowExecution;
  if (execution === undefined) {
    throw new Error("Report delivery requires a Temporal workflow execution");
  }
  return {
    backend: deliveryBackend(store),
    addresses: await resolvePostalAddressesForReport(reportType),
    send: (input) => sendPostalEmail(input),
    now: () => new Date().toISOString(),
    owner: `${execution.workflowId}/${execution.runId}/${info.activityId}/${String(info.attempt)}`,
    attemptStartedAt,
    receiptPrefix: store.prefix,
    statePrefix: Bun.env["REPORT_STATE_PREFIX"] ?? "reports/state",
  };
}

export async function deliverReportWithDependencies(
  rawReport: ReportEnvelopeV1,
  dependencies: ReportDeliveryDependencies,
): Promise<ReportDeliveryResult> {
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  const receiptKey = reportReceiptKey(report, dependencies.receiptPrefix);
  const stateKey = reportStateKey(report, dependencies.statePrefix);
  const pushToHub = dependencies.pushToHub ?? tryPushReportRunToHub;
  const existing = await dependencies.backend.readReceipt(receiptKey);
  if (existing !== undefined) {
    reportDeliveryTotal.inc({
      ...metricLabels(report),
      outcome: "deduplicated",
    });
    recordAccepted(report, existing.acceptedAt);
    await pushSentReportReceiptToHub(
      pushToHub,
      report,
      dependencies.addresses,
      existing,
    );
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
    await pushSentReportReceiptToHub(
      pushToHub,
      report,
      dependencies.addresses,
      receipt,
    );
    return { ...receipt, receiptKey, deduplicated: true };
  }

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
  const settled = await dependencies.backend.readReceipt(receiptKey);
  if (settled !== undefined) {
    reportDeliveryTotal.inc({
      ...metricLabels(report),
      outcome: "deduplicated",
    });
    recordAccepted(report, settled.acceptedAt);
    await pushSentReportReceiptToHub(
      pushToHub,
      report,
      dependencies.addresses,
      settled,
    );
    return { ...settled, receiptKey, deduplicated: true };
  }

  const { recipient, sender } = dependencies.addresses;
  const subject = reportSubject(report);
  let receipt: ReportDeliveryReceiptV1;
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
      // Keep inside send args so pre-send state writes cannot extend the lease.
      signal: reportSendAbortSignal({
        reportRunId: report.reportRunId,
        attemptStartedAt: dependencies.attemptStartedAt,
        now: dependencies.now(),
      }),
    });
    await assertReportSendStillOwned({
      backend: dependencies.backend,
      claimKey: reportSendClaimKey(stateKey),
      reportRunId: report.reportRunId,
      owner: dependencies.owner,
    });
    receipt = ReportDeliveryReceiptV1Schema.parse({
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
    if (!(await dependencies.backend.writeReceipt(receiptKey, receipt))) {
      throw new Error(
        `Report ${report.reportRunId} was recorded by another attempt while this one persisted; this message is a duplicate and its receipt was discarded`,
      );
    }
    reportDeliveryTotal.inc({ ...metricLabels(report), outcome: "accepted" });
    recordAccepted(report, receipt.acceptedAt);
  } catch (error: unknown) {
    reportDeliveryTotal.inc({ ...metricLabels(report), outcome: "failed" });
    throw error;
  }

  await pushSentReportReceiptToHub(
    pushToHub,
    report,
    dependencies.addresses,
    receipt,
  );
  return { ...receipt, receiptKey, deduplicated: false };
}

async function deliverWithOptionalDailyPolicy(
  report: ReportEnvelopeV1,
  attemptStartedAt: string,
): Promise<ReportDeliveryResult | SkippedNotification> {
  return deliverEnvelopeWithDailyPolicy({
    report,
    attemptStartedAt,
    namespace: Context.current().info.namespace,
    deliverCadence: deliverReport,
    prepareChangedDeps: async () => {
      const store = reportReceiptStore();
      const deps = await activityDeliveryDependencies(
        store,
        attemptStartedAt,
        report.reportType,
      );
      return {
        store,
        owner: deps.owner,
        now: deps.now,
        addresses: deps.addresses,
        legacyDeliveryStarted: async () =>
          (await deps.backend.readState(
            reportStateKey(report, deps.statePrefix),
          )) !== undefined ||
          (await deps.backend.readReceipt(
            reportReceiptKey(report, deps.receiptPrefix),
          )) !== undefined,
        readAcceptedReceipt: async (candidate) => {
          const receiptKey = reportReceiptKey(candidate, deps.receiptPrefix);
          const receipt = await deps.backend.readReceipt(receiptKey);
          return receipt === undefined
            ? undefined
            : { ...receipt, receiptKey, deduplicated: true };
        },
        hasAcceptedState: async (candidate) => {
          const state = await deps.backend.readState(
            reportStateKey(candidate, deps.statePrefix),
          );
          return state?.delivery.status === "accepted";
        },
        deliverCandidate: (candidate) =>
          deliverReportWithDependencies(candidate, deps),
        onSkippedReason: (reason) => {
          reportDeliveryTotal.inc({ ...metricLabels(report), outcome: reason });
        },
      };
    },
  });
}

export async function deliverScheduledReport(
  rawReport: ReportEnvelopeV1,
): Promise<ReportDeliveryResult | SkippedNotification> {
  const attemptStartedAt = new Date().toISOString();
  return deliverWithOptionalDailyPolicy(
    ReportEnvelopeV1Schema.parse(rawReport),
    attemptStartedAt,
  );
}

export const reportDeliveryActivities = {
  deliverReport,
  deliverScheduledReport,
  async deliverActivityReport(
    input: ActivityReportInput,
  ): Promise<ReportDeliveryResult | SkippedNotification> {
    const attemptStartedAt = new Date().toISOString();
    return deliverWithOptionalDailyPolicy(
      createActivityReportEnvelope(input),
      attemptStartedAt,
    );
  },
};
