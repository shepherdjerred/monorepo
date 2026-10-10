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
import {
  resolvePostalAddresses,
  sendPostalEmail,
} from "#shared/infra/postal.ts";
import type {
  PostalSendInput,
  PostalSendResult,
} from "#shared/infra/postal.ts";
import {
  assertReportSendStillOwned,
  claimReportSend,
  reportSendAbortSignal,
  reportSendClaimKey,
  ReportSendClaimV1Schema,
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
import { dailyReportNotificationsConfig } from "#config/report-notifications.ts";
import { notificationBackend } from "./report-notification-store.ts";
import {
  deliverDailyNotification,
  notificationFamilyPath,
  NotificationModeSchema,
  selectNotificationMode,
  usesDailyNotificationPolicy,
  type SkippedNotification,
} from "./report-notification-policy.ts";

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
  /**
   * Create-only. Resolves false when a receipt already exists, which is how
   * at-most-one recorded delivery is enforced: the storage layer picks the
   * winner atomically instead of an attempt checking and then writing.
   */
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
      return stored?.value;
    },
    writeReceipt: (key, receipt) =>
      conditionalWrite(() =>
        writeJson(store, key, receipt, {
          expectedEtag: undefined,
        }),
      ),
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
    writeSendClaim: (key, claim, expectedEtag) =>
      conditionalWrite(() =>
        writeJson(store, key, ReportSendClaimV1Schema.parse(claim), {
          expectedEtag,
        }),
      ),
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
    addresses: await resolvePostalAddresses(),
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
    // Losing this race is the desired end state: some attempt published a
    // receipt for this report, which is all this branch was restoring.
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
    // The arbiter. Create-only, so if a successor already recorded this
    // report the storage layer rejects this write rather than this attempt
    // deciding from a stale read — the ownership check above narrows the race
    // but cannot close it, because a takeover can land between checking and
    // writing. Exactly one attempt can own the recorded delivery.
    const recorded = await dependencies.backend.writeReceipt(
      receiptKey,
      receipt,
    );
    if (!recorded) {
      throw new Error(
        `Report ${report.reportRunId} was recorded by another attempt while this one persisted; this message is a duplicate and its receipt was discarded`,
      );
    }
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
  ): Promise<ReportDeliveryResult | SkippedNotification> {
    const attemptStartedAt = new Date().toISOString();
    const report = createActivityReportEnvelope(input);
    if (!usesDailyNotificationPolicy(report)) return deliverReport(report);
    const info = Context.current().info;
    const mode = await dailyNotificationMode(report, info.namespace);
    return mode === "changed"
      ? deliverDailyActivityNotification(report, attemptStartedAt)
      : deliverReport(report);
  },
};

async function dailyNotificationMode(
  report: ReportEnvelopeV1,
  namespace: string,
) {
  const store = reportReceiptStore();
  const backend = deliveryBackend(store);
  const key = `reports/notifications/modes/${safeKeyPart(namespace)}/${notificationFamilyPath(report)}/${safeKeyPart(report.reportRunId)}.json`;
  return selectNotificationMode({
    read: async () => {
      const stored = await readJson(store, key, NotificationModeSchema);
      return stored?.value;
    },
    write: (value) =>
      conditionalWrite(() =>
        writeJson(store, key, value, { expectedEtag: undefined }),
      ),
    legacyDeliveryStarted: async () => {
      const state = await backend.readState(
        reportStateKey(
          report,
          Bun.env["REPORT_STATE_PREFIX"] ?? "reports/state",
        ),
      );
      const receipt = await backend.readReceipt(
        reportReceiptKey(report, store.prefix),
      );
      return state !== undefined || receipt !== undefined;
    },
    enabled: async () => {
      const config = await dailyReportNotificationsConfig(namespace);
      return config.value;
    },
  });
}

async function deliverDailyActivityNotification(
  report: ReportEnvelopeV1,
  attemptStartedAt: string,
): Promise<ReportDeliveryResult | SkippedNotification> {
  const store = reportReceiptStore();
  const backend = deliveryBackend(store);
  const info = Context.current().info;
  const execution = info.workflowExecution;
  if (execution === undefined)
    throw new Error("Notification requires a workflow execution");
  const deps: ReportDeliveryDependencies = {
    backend,
    addresses: await resolvePostalAddresses(),
    send: (input) => sendPostalEmail(input),
    now: () => new Date().toISOString(),
    owner: `${execution.workflowId}/${execution.runId}/${info.activityId}/${String(info.attempt)}`,
    attemptStartedAt,
    receiptPrefix: store.prefix,
    statePrefix: Bun.env["REPORT_STATE_PREFIX"] ?? "reports/state",
  };
  const result = await deliverDailyNotification(report, {
    ...deps,
    namespace: info.namespace,
    backend: notificationBackend(store),
    accepted: async (candidate) => {
      const receiptKey = reportReceiptKey(candidate, deps.receiptPrefix);
      const receipt = await backend.readReceipt(receiptKey);
      if (receipt !== undefined)
        return { ...receipt, receiptKey, deduplicated: true };
      const state = await backend.readState(
        reportStateKey(candidate, deps.statePrefix),
      );
      if (state?.delivery.status !== "accepted") return;
      // Restore an accepted state's missing receipt through the same core.
      return deliverReportWithDependencies(candidate, deps);
    },
    deliver: (candidate) => deliverReportWithDependencies(candidate, deps),
  });
  if ("outcome" in result) {
    reportDeliveryTotal.inc({
      ...metricLabels(report),
      outcome: result.reason,
    });
  }
  return result;
}
