import type { AlertLedgerRepository } from "#application/ports";
import {
  AlertDetailSchema,
  type AlertDetail,
  type AlertScope,
} from "#shared/schema";

export function unexpected(): Promise<never> {
  return Promise.reject(new Error("unexpected service call"));
}

/** An alert ledger that only answers readiness; any other call is a bug. */
export function readinessOnlyLedger(): AlertLedgerRepository {
  return {
    ingestWebhook: unexpected,
    reconcileSnapshot: unexpected,
    recordSnapshotFailure: unexpected,
    listAlerts: unexpected,
    getAlert: unexpected,
    listEvents: unexpected,
    summary: unexpected,
    checkDatabase: () => Promise.resolve(),
    systemStatus: unexpected,
    pendingEmails: unexpected,
    claimPendingEmails: unexpected,
    markEmailSent: unexpected,
    markEmailFailed: unexpected,
    claimPendingHomeAssistantNotifications: unexpected,
    markHomeAssistantSent: unexpected,
    markHomeAssistantFailed: unexpected,
    purgeExpiredRecords: unexpected,
    disconnect: unexpected,
  };
}

export const FIXTURE_HOUSE_ALERTS: readonly AlertDetail[] = [
  AlertDetailSchema.parse({
    id: `alert_${"1".repeat(32)}`,
    fingerprint: "fixture-house-litter-robot",
    alertname: "LitterRobotWasteDrawerNearlyFull",
    namespace: null,
    severity: "critical",
    summary: "Litter-Robot waste drawer is 90% full",
    lifecycleState: "open",
    suppressionState: "none",
    resolutionSource: null,
    openedAt: "2026-08-08T17:45:00Z",
    resolvedAt: null,
    lastSeenAt: "2026-08-08T18:05:00Z",
    generatorUrl: null,
    labels: {
      alertname: "LitterRobotWasteDrawerNearlyFull",
      category: "household",
      severity: "critical",
      service: "pet-care",
      device: "Litter-Robot 4",
      room: "Laundry room",
    },
    annotations: {
      summary: "Litter-Robot waste drawer is 90% full",
      description: "Empty the waste drawer before the next clean cycle.",
    },
    events: [
      {
        id: `event_${"1".repeat(32)}`,
        occurrenceId: `alert_${"1".repeat(32)}`,
        type: "opened",
        occurredAt: "2026-08-08T17:45:00Z",
        source: "webhook",
        detail: null,
      },
    ],
    deliveries: [],
    deliveriesNextCursor: null,
  }),
  AlertDetailSchema.parse({
    id: `alert_${"2".repeat(32)}`,
    fingerprint: "fixture-house-roborock",
    alertname: "RoborockConsumableDue",
    namespace: null,
    severity: "warning",
    summary: "Downstairs Roborock main brush needs replacement (3h left)",
    lifecycleState: "open",
    suppressionState: "none",
    resolutionSource: null,
    openedAt: "2026-08-08T16:30:00Z",
    resolvedAt: null,
    lastSeenAt: "2026-08-08T18:05:00Z",
    generatorUrl: null,
    labels: {
      alertname: "RoborockConsumableDue",
      category: "household",
      severity: "warning",
      service: "roborock",
      vacuum: "Downstairs Roborock",
      consumable: "main_brush",
    },
    annotations: {
      summary: "Downstairs Roborock main brush needs replacement (3h left)",
      description: "Replace the main brush and reset the consumable timer.",
    },
    events: [
      {
        id: `event_${"2".repeat(32)}`,
        occurrenceId: `alert_${"2".repeat(32)}`,
        type: "opened",
        occurredAt: "2026-08-08T16:30:00Z",
        source: "webhook",
        detail: null,
      },
    ],
    deliveries: [],
    deliveriesNextCursor: null,
  }),
  AlertDetailSchema.parse({
    id: `alert_${"3".repeat(32)}`,
    fingerprint: "fixture-house-petlibro",
    alertname: "PetLibroFountainFilterDue",
    namespace: null,
    severity: "warning",
    summary: "Dockstream water fountain filter replacement is due",
    lifecycleState: "open",
    suppressionState: "none",
    resolutionSource: null,
    openedAt: "2026-08-08T15:15:00Z",
    resolvedAt: null,
    lastSeenAt: "2026-08-08T18:05:00Z",
    generatorUrl: null,
    labels: {
      alertname: "PetLibroFountainFilterDue",
      category: "household",
      severity: "warning",
      service: "pet-care",
      device: "Dockstream Fountain",
      room: "Kitchen",
    },
    annotations: {
      summary: "Dockstream water fountain filter replacement is due",
      description: "Rinse and install a fresh filter in the fountain.",
    },
    events: [
      {
        id: `event_${"3".repeat(32)}`,
        occurrenceId: `alert_${"3".repeat(32)}`,
        type: "opened",
        occurredAt: "2026-08-08T15:15:00Z",
        source: "webhook",
        detail: null,
      },
    ],
    deliveries: [],
    deliveriesNextCursor: null,
  }),
];

export function matchesAlertScope(
  labels: Readonly<Record<string, string>>,
  scope: AlertScope | undefined,
): boolean {
  const isHouse = labels["category"] === "household";
  switch (scope) {
    case "house":
      return isHouse;
    case "ops":
      return !isHouse;
    case "all":
    case undefined:
      return true;
  }
}
