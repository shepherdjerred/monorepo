import { describe, expect, it } from "vitest";

import { AlertService } from "#application/alert-service";
import type {
  AlertLedgerRepository,
  AlertmanagerPort,
  IngestWebhookInput,
  PostalPort,
  PreviewPort,
} from "#application/ports";
import { fixedClock } from "#shared/time";

function unexpected(): Promise<never> {
  return Promise.reject(new Error("unexpected service call"));
}

describe("webhook evidence", () => {
  it("hashes and retains the original JSON before contract normalization", async () => {
    let ingested: IngestWebhookInput | undefined;
    const repository: AlertLedgerRepository = {
      ingestWebhook: (input) => {
        ingested = input;
        return Promise.resolve({
          deliveryId: "123e4567-e89b-42d3-a456-426614174000",
          opened: 1,
          resolved: 0,
          emailQueued: false,
        });
      },
      reconcileSnapshot: unexpected,
      recordSnapshotFailure: unexpected,
      listAlerts: unexpected,
      getAlert: unexpected,
      listEvents: unexpected,
      summary: unexpected,
      checkDatabase: unexpected,
      systemStatus: unexpected,
      pendingEmails: unexpected,
      claimPendingEmails: unexpected,
      markEmailSent: unexpected,
      markEmailFailed: unexpected,
      purgeExpiredRawPayloads: unexpected,
      disconnect: unexpected,
    };
    const alertmanager: AlertmanagerPort = { activeAlerts: unexpected };
    const postal: PostalPort = { send: unexpected };
    const previews: PreviewPort = {
      previews: unexpected,
      health: unexpected,
    };
    const service = new AlertService({
      repository,
      alertmanager,
      postal,
      previews,
      clock: fixedClock("2026-08-08T18:00:01Z"),
      emailEnabled: false,
    });
    const rawBody = JSON.stringify(
      {
        version: "4",
        groupKey: '{}:{alertname="DiskFull"}',
        truncatedAlerts: 0,
        status: "firing",
        receiver: "alert-dashboard",
        groupLabels: { alertname: "DiskFull" },
        commonLabels: { alertname: "DiskFull", severity: "warning" },
        commonAnnotations: { summary: "Disk is full" },
        externalURL: "https://alertmanager.example.test",
        alerts: [
          {
            status: "firing",
            labels: { alertname: "DiskFull", severity: "warning" },
            annotations: { summary: "Disk is full" },
            startsAt: "2026-08-08T18:00:00Z",
            endsAt: "0001-01-01T00:00:00Z",
            generatorURL: "https://prometheus.example.test/graph",
            fingerprint: "fixture-fingerprint",
            futureAlertField: true,
          },
        ],
        futureTopLevelField: { retained: true },
      },
      null,
      2,
    );

    await service.ingestWebhook(rawBody);

    if (ingested === undefined) throw new Error("webhook was not ingested");
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(rawBody);
    expect(ingested.payloadHash).toBe(hasher.digest("hex"));
    expect(ingested.rawPayload["futureTopLevelField"]).toEqual({
      retained: true,
    });
    expect(ingested.rawPayload).toHaveProperty(
      "alerts.0.futureAlertField",
      true,
    );
    expect(ingested.payload).not.toHaveProperty("futureTopLevelField");
  });
});
