import { resolveMailAddressesForReport } from "#config/mail.ts";
import { dailyReportNotificationsConfig } from "#config/report-notifications.ts";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "#shared/reports/report.ts";
import { recordReportHeartbeat } from "./report-heartbeat-index.ts";
import {
  pushSentReportReceiptToHub,
  pushSkippedReportNotificationToHub,
  tryPushReportRunToHub,
} from "./report-hub-ingest.ts";
import {
  conditionalWrite,
  readJson,
  writeJson,
  type ReportReceiptStore,
} from "./report-object-store.ts";
import {
  deliverDailyNotification,
  NotificationFamilySchema,
  notificationFamilyPath,
  NotificationModeSchema,
  selectNotificationMode,
  SkippedNotificationSchema,
  usesDailyNotificationPolicy,
  type NotificationBackend,
  type NotificationMode,
  type SkippedNotification,
} from "./report-notification-policy.ts";

function safeKeyPart(value: string): string {
  return value.replaceAll(/[^\w.=-]+/g, "-");
}

export function notificationBackend(
  store: ReportReceiptStore,
): NotificationBackend {
  return {
    readObservation: async (key) => {
      const stored = await readJson(store, key, ReportEnvelopeV1Schema);
      return stored?.value;
    },
    writeObservation: (key, report) =>
      conditionalWrite(() =>
        writeJson(store, key, report, { expectedEtag: undefined }),
      ),
    readSkip: async (key) => {
      const stored = await readJson(store, key, SkippedNotificationSchema);
      if (stored !== undefined)
        await recordReportHeartbeat(store, key, stored.value.completedAt);
      return stored?.value;
    },
    writeSkip: async (key, result) => {
      const recorded = await conditionalWrite(() =>
        writeJson(store, key, result, { expectedEtag: undefined }),
      );
      if (recorded) await recordReportHeartbeat(store, key, result.completedAt);
      return recorded;
    },
    readFamily: (key) => readJson(store, key, NotificationFamilySchema),
    writeFamily: (key, value, expectedEtag) =>
      conditionalWrite(() =>
        writeJson(store, key, NotificationFamilySchema.parse(value), {
          expectedEtag,
        }),
      ),
  };
}

export async function selectDailyNotificationModeForRun(input: {
  store: ReportReceiptStore;
  report: ReportEnvelopeV1;
  namespace: string;
  legacyDeliveryStarted: () => Promise<boolean>;
}): Promise<NotificationMode["mode"]> {
  const { store, report, namespace, legacyDeliveryStarted } = input;
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
    legacyDeliveryStarted,
    enabled: async () => {
      const config = await dailyReportNotificationsConfig(namespace);
      return config.value;
    },
  });
}

export async function deliverEnvelopeWithDailyPolicy<
  T extends {
    reportRunId: string;
    acceptedAt: string;
    messageId: string;
    receiptKey: string;
    deduplicated: boolean;
  },
>(input: {
  report: ReportEnvelopeV1;
  attemptStartedAt: string;
  namespace: string;
  deliverCadence: (report: ReportEnvelopeV1) => Promise<T>;
  prepareChangedDeps: () => Promise<{
    store: ReportReceiptStore;
    owner: string;
    now: () => string;
    addresses: { sender: string; recipient: string };
    legacyDeliveryStarted: () => Promise<boolean>;
    readAcceptedReceipt: (
      candidate: ReportEnvelopeV1,
    ) => Promise<T | undefined>;
    hasAcceptedState: (candidate: ReportEnvelopeV1) => Promise<boolean>;
    deliverCandidate: (candidate: ReportEnvelopeV1) => Promise<T>;
    onSkippedReason: (reason: SkippedNotification["reason"]) => void;
  }>;
}): Promise<T | SkippedNotification> {
  if (!usesDailyNotificationPolicy(input.report)) {
    return input.deliverCadence(input.report);
  }
  const deps = await input.prepareChangedDeps();
  const mode = await selectDailyNotificationModeForRun({
    store: deps.store,
    report: input.report,
    namespace: input.namespace,
    legacyDeliveryStarted: deps.legacyDeliveryStarted,
  });
  if (mode !== "changed") {
    return input.deliverCadence(input.report);
  }
  const backend = notificationBackend(deps.store);
  const result = await deliverDailyNotification(input.report, {
    backend,
    namespace: input.namespace,
    owner: deps.owner,
    attemptStartedAt: input.attemptStartedAt,
    now: deps.now,
    accepted: async (candidate) => {
      const existing = await deps.readAcceptedReceipt(candidate);
      if (existing !== undefined) {
        await pushSentReportReceiptToHub(
          tryPushReportRunToHub,
          candidate,
          deps.addresses,
          existing,
        );
        return existing;
      }
      return (await deps.hasAcceptedState(candidate))
        ? deps.deliverCandidate(candidate)
        : undefined;
    },
    deliver: deps.deliverCandidate,
  });
  if ("outcome" in result) {
    deps.onSkippedReason(result.reason);
    await pushSkippedReportNotificationToHub({
      report: input.report,
      skipped: result,
      resolveAddresses: async (reportType) =>
        reportType === input.report.reportType
          ? deps.addresses
          : resolveMailAddressesForReport(reportType),
      readObservation: backend.readObservation,
    });
  }
  return result;
}
