import { describe, expect, it } from "vitest";

import { AlertService } from "#application/alert-service";
import type {
  AlertLedgerRepository,
  AlertmanagerPort,
  HomeAssistantNotification,
  HomeAssistantSendFailureInput,
  HomeAssistantSendSuccessInput,
  IngestWebhookInput,
  MailMessage,
  MailPort,
  PreviewPort,
} from "#application/ports";
import { readinessOnlyLedger } from "#test-fixtures/alert-ledger";
import {
  InstantTextSchema,
  fixedClock,
  instantTextToEpochNanoseconds,
} from "#shared/time";

function unexpected(): Promise<never> {
  return Promise.reject(new Error("unexpected service call"));
}

describe("webhook evidence", () => {
  it("hashes and retains the original JSON before contract normalization", async () => {
    let ingested: IngestWebhookInput | undefined;
    const repository: AlertLedgerRepository = {
      ...readinessOnlyLedger(),
      ingestWebhook: (input) => {
        ingested = input;
        return Promise.resolve({
          deliveryId: "123e4567-e89b-42d3-a456-426614174000",
          opened: 1,
          resolved: 0,
          emailQueued: false,
        });
      },
      checkDatabase: unexpected,
    };
    const alertmanager: AlertmanagerPort = { activeAlerts: unexpected };
    const mail: MailPort = { send: unexpected };
    const previews: PreviewPort = {
      previews: unexpected,
      health: unexpected,
    };
    const service = new AlertService({
      repository,
      alertmanager,
      mail,
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

  it("forwards plainBody from claimed outbox rows to Mail", async () => {
    const sent: MailMessage[] = [];
    const markedSent: string[] = [];
    const repository: AlertLedgerRepository = {
      ...readinessOnlyLedger(),
      checkDatabase: unexpected,
      claimPendingEmails: () =>
        Promise.resolve([
          {
            id: "outbox-1",
            sendClaimId: "claim-1",
            messageId: "<alerts-1@sjer.red>",
            subject: "Critical: Storage disk full",
            htmlBody: "<!DOCTYPE html><p>Disk full</p>",
            plainBody: "Storage · Critical\nDisk full\n",
            attemptCount: 0,
          },
        ]),
      markEmailSent: (input) => {
        markedSent.push(input.id);
        return Promise.resolve();
      },
    };
    const service = new AlertService({
      repository,
      alertmanager: { activeAlerts: unexpected },
      mail: {
        send: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
      },
      previews: { previews: unexpected, health: unexpected },
      clock: fixedClock("2026-08-08T18:00:01Z"),
      emailEnabled: true,
    });

    expect(await service.drainEmailOutbox()).toBe(1);
    expect(markedSent).toEqual(["outbox-1"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.plainBody).toBe("Storage · Critical\nDisk full\n");
  });
});

describe("Home Assistant outbox drain", () => {
  it("is a no-op when Home Assistant is unconfigured", async () => {
    const service = new AlertService({
      repository: readinessOnlyLedger(),
      alertmanager: { activeAlerts: unexpected },
      mail: { send: unexpected },
      homeAssistant: null,
      previews: { previews: unexpected, health: unexpected },
      clock: fixedClock("2026-08-08T18:00:01Z"),
      emailEnabled: false,
    });

    expect(await service.drainHomeAssistantOutbox()).toBe(0);
  });

  it("sends claimed notifications and backs off exponentially on failure", async () => {
    const sent: HomeAssistantNotification[] = [];
    const markedSent: HomeAssistantSendSuccessInput[] = [];
    const markedFailed: HomeAssistantSendFailureInput[] = [];
    const repository: AlertLedgerRepository = {
      ...readinessOnlyLedger(),
      claimPendingHomeAssistantNotifications: () =>
        Promise.resolve([
          {
            id: "outbox-ok",
            sendClaimId: "claim-ok",
            attemptCount: 0,
            notification: {
              action: "notify",
              notificationId: "hub-house-fp-1",
              title: "[House] RoborockConsumableDue",
              message: "Main brush due",
            },
          },
          {
            id: "outbox-fail",
            sendClaimId: "claim-fail",
            attemptCount: 2,
            notification: {
              action: "dismiss",
              notificationId: "hub-house-fp-2",
            },
          },
        ]),
      markHomeAssistantSent: (value) => {
        markedSent.push(value);
        return Promise.resolve();
      },
      markHomeAssistantFailed: (value) => {
        markedFailed.push(value);
        return Promise.resolve();
      },
    };
    const service = new AlertService({
      repository,
      alertmanager: { activeAlerts: unexpected },
      mail: { send: unexpected },
      homeAssistant: {
        send: (notification) => {
          if (notification.action === "dismiss") {
            return Promise.reject(new Error("HA unreachable"));
          }
          sent.push(notification);
          return Promise.resolve();
        },
      },
      previews: { previews: unexpected, health: unexpected },
      clock: fixedClock("2026-08-08T18:00:00Z"),
      emailEnabled: false,
    });

    expect(await service.drainHomeAssistantOutbox()).toBe(2);
    expect(sent).toHaveLength(1);
    expect(markedSent).toEqual([
      {
        id: "outbox-ok",
        sendClaimId: "claim-ok",
        sentAtNs: instantTextToEpochNanoseconds(
          InstantTextSchema.parse("2026-08-08T18:00:00Z"),
        ),
      },
    ]);
    // attemptCount=2 -> 30 * 2^2 = 120s backoff
    expect(markedFailed).toEqual([
      {
        id: "outbox-fail",
        sendClaimId: "claim-fail",
        failedAtNs: instantTextToEpochNanoseconds(
          InstantTextSchema.parse("2026-08-08T18:00:00Z"),
        ),
        nextAttemptAtNs: instantTextToEpochNanoseconds(
          InstantTextSchema.parse("2026-08-08T18:02:00Z"),
        ),
        error: "HA unreachable",
      },
    ]);
  });

  it("serializes overlapping drain calls so dismiss cannot race ahead of notify", async () => {
    const events: string[] = [];
    let notifyEntered: (() => void) | undefined;
    const enteredFirstSend = new Promise<void>((resolve) => {
      notifyEntered = resolve;
    });
    let releaseFirstSend: (() => void) | undefined;
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    let batchNumber = 0;
    const repository: AlertLedgerRepository = {
      ...readinessOnlyLedger(),
      claimPendingHomeAssistantNotifications: () => {
        batchNumber += 1;
        events.push(`claim-${String(batchNumber)}`);
        if (batchNumber === 1) {
          return Promise.resolve([
            {
              id: "outbox-notify",
              sendClaimId: "claim-notify",
              attemptCount: 0,
              notification: {
                action: "notify",
                notificationId: "hub-house-fp-race",
                title: "[House] RoborockConsumableDue",
                message: "Main brush due",
              },
            },
          ]);
        }
        return Promise.resolve([
          {
            id: "outbox-dismiss",
            sendClaimId: "claim-dismiss",
            attemptCount: 0,
            notification: {
              action: "dismiss",
              notificationId: "hub-house-fp-race",
            },
          },
        ]);
      },
      markHomeAssistantSent: (value) => {
        events.push(`sent-${value.id}`);
        return Promise.resolve();
      },
    };
    const service = new AlertService({
      repository,
      alertmanager: { activeAlerts: unexpected },
      mail: { send: unexpected },
      homeAssistant: {
        send: async (notification) => {
          events.push(`send-${notification.action}`);
          if (notification.action === "notify") {
            notifyEntered?.();
            await firstSendGate;
          }
        },
      },
      previews: { previews: unexpected, health: unexpected },
      clock: fixedClock("2026-08-08T18:00:00Z"),
      emailEnabled: false,
    });

    const first = service.drainHomeAssistantOutbox();
    const second = service.drainHomeAssistantOutbox();
    await enteredFirstSend;
    expect(events).toEqual(["claim-1", "send-notify"]);

    if (releaseFirstSend === undefined) throw new Error("missing gate");
    releaseFirstSend();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "claim-1",
      "send-notify",
      "sent-outbox-notify",
      "claim-2",
      "send-dismiss",
      "sent-outbox-dismiss",
    ]);
  });
});
