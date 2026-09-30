import type { AlertLedgerRepository } from "#application/ports";

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
    purgeExpiredRawPayloads: unexpected,
    disconnect: unexpected,
  };
}
