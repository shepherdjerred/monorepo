import type { ReportEnvelopeV1 } from "#shared/reports/report.ts";
import type { PostalSendInput } from "#shared/infra/postal.ts";
import {
  deliverReportWithDependencies,
  reportReceiptKey,
  type ReportDeliveryBackend,
  type ReportDeliveryReceiptV1,
  type ReportStateV1,
} from "./report-delivery.ts";
import type { ReportSendClaimV1 } from "./report-delivery-lease.ts";
import type {
  NotificationBackend,
  NotificationFamily,
  SkippedNotification,
} from "./report-notification-policy.ts";

/** In-memory CAS and Postal boundary; notification and delivery logic are real. */
export function notificationDeliveryHarness() {
  const observations = new Map<string, ReportEnvelopeV1>();
  const skips = new Map<string, SkippedNotification>();
  const families = new Map<
    string,
    { value: NotificationFamily; etag: string }
  >();
  const receipts = new Map<string, ReportDeliveryReceiptV1>();
  const states = new Map<string, ReportStateV1>();
  const claims = new Map<string, { claim: ReportSendClaimV1; etag: string }>();
  const sent: string[] = [];
  let version = 0;
  const faults = { failFamilySettlement: false, failSend: false };
  const backend: NotificationBackend = {
    readObservation: (key) => Promise.resolve(observations.get(key)),
    writeObservation: (key, value) => {
      if (observations.has(key)) return Promise.resolve(false);
      observations.set(key, structuredClone(value));
      return Promise.resolve(true);
    },
    readSkip: (key) => Promise.resolve(skips.get(key)),
    writeSkip: (key, value) => {
      if (skips.has(key)) return Promise.resolve(false);
      skips.set(key, value);
      return Promise.resolve(true);
    },
    readFamily: (key) => Promise.resolve(structuredClone(families.get(key))),
    writeFamily: (key, value, expectedEtag) => {
      if (faults.failFamilySettlement && value.pending === undefined) {
        faults.failFamilySettlement = false;
        throw new Error("crash after accepted receipt");
      }
      if (families.get(key)?.etag !== expectedEtag)
        return Promise.resolve(false);
      families.set(key, { value, etag: String(++version) });
      return Promise.resolve(true);
    },
  };
  const deliveryBackend: ReportDeliveryBackend = {
    readReceipt: (key) => Promise.resolve(receipts.get(key)),
    writeReceipt: (key, value) => {
      if (receipts.has(key)) return Promise.resolve(false);
      receipts.set(key, value);
      return Promise.resolve(true);
    },
    readState: (key) => Promise.resolve(states.get(key)),
    writeState: (key, value) => {
      states.set(key, value);
      return Promise.resolve();
    },
    readSendClaim: (key) => Promise.resolve(claims.get(key)),
    writeSendClaim: (key, claim, expectedEtag) => {
      if (claims.get(key)?.etag !== expectedEtag) return Promise.resolve(false);
      claims.set(key, { claim, etag: String(++version) });
      return Promise.resolve(true);
    },
  };
  function deps(now: string, owner = now, namespace = "prod") {
    const deliveryDeps = {
      backend: deliveryBackend,
      now: () => now,
      owner,
      attemptStartedAt: now,
      addresses: {
        recipient: "recipient@example.com",
        sender: "sender@example.com",
      },
      send: (input: PostalSendInput) => {
        if (faults.failSend) throw new Error("Postal unavailable");
        const reportRunId = input.headers?.["X-Report-Run-ID"];
        if (reportRunId === undefined)
          throw new Error("Missing report run header");
        sent.push(reportRunId);
        return Promise.resolve({
          messageId: `mail-${String(sent.length)}`,
          recipientId: 42,
          subject: input.subject,
          tag: input.tag,
        });
      },
    };
    return {
      backend,
      namespace,
      owner,
      attemptStartedAt: now,
      now: () => now,
      accepted: (candidate: ReportEnvelopeV1) => {
        const receiptKey = reportReceiptKey(candidate);
        const value = receipts.get(receiptKey);
        return Promise.resolve(
          value === undefined
            ? undefined
            : { ...value, receiptKey, deduplicated: true },
        );
      },
      deliver: (candidate: ReportEnvelopeV1) =>
        deliverReportWithDependencies(candidate, deliveryDeps),
    };
  }
  return { deps, sent, observations, skips, families, faults };
}
