import { ReportEnvelopeV1Schema } from "#shared/reports/report.ts";
import {
  conditionalWrite,
  readJson,
  writeJson,
  type ReportReceiptStore,
} from "./report-object-store.ts";
import {
  NotificationFamilySchema,
  SkippedNotificationSchema,
  type NotificationBackend,
} from "./report-notification-policy.ts";

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
      return stored?.value;
    },
    writeSkip: (key, result) =>
      conditionalWrite(() =>
        writeJson(store, key, result, { expectedEtag: undefined }),
      ),
    readFamily: (key) => readJson(store, key, NotificationFamilySchema),
    writeFamily: (key, value, expectedEtag) =>
      conditionalWrite(() =>
        writeJson(store, key, NotificationFamilySchema.parse(value), {
          expectedEtag,
        }),
      ),
  };
}
