import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  authenticateBearerClient,
  isSenderDomainAllowed,
  verifySecretConstantTime,
} from "./auth.ts";
import { loadMailConfig } from "./config.ts";
import { parseInboundMime, synthesizeMimeMessage } from "./mime.ts";
import { MailStore, type EnqueueMessageInput } from "./store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function sampleEnqueueInput(
  overrides: Partial<EnqueueMessageInput> = {},
): EnqueueMessageInput {
  const rawMime = new TextEncoder().encode(
    "From: Alerts <alerts@sjer.red>\r\nTo: ops@sjer.red\r\nSubject: Hello\r\nMessage-ID: <msg-1@sjer.red>\r\n\r\nBody text\r\n",
  );
  return {
    clientId: "alert-dashboard",
    protocol: "http",
    idempotencyKey: null,
    rfcMessageId: "<msg-1@sjer.red>",
    mailFrom: "alerts@sjer.red",
    recipients: ["ops@sjer.red"],
    fromHeader: "Alerts <alerts@sjer.red>",
    toHeader: "ops@sjer.red",
    subject: "Hello",
    tag: "incident",
    plainBody: "Body text",
    htmlBody: null,
    headers: { subject: "Hello" },
    rawMime,
    nowIso: "2026-11-24T12:00:00.000Z",
    ...overrides,
  };
}

describe("MailStore idempotency and tenant isolation", () => {
  test("deduplicates matching (client_id, idempotency_key) and isolates across clients", () => {
    const store = MailStore.open(":memory:");
    try {
      const first = store.enqueueMessage(
        sampleEnqueueInput({
          clientId: "alert-dashboard",
          idempotencyKey: "idem-42",
          subject: "Original subject",
        }),
      );
      expect(first.deduplicated).toBe(false);

      const replay = store.enqueueMessage(
        sampleEnqueueInput({
          clientId: "alert-dashboard",
          idempotencyKey: "idem-42",
          subject: "Mutated subject",
        }),
      );
      expect(replay.deduplicated).toBe(true);
      expect(replay.message.id).toBe(first.message.id);
      expect(replay.message.subject).toBe("Original subject");

      const otherClient = store.enqueueMessage(
        sampleEnqueueInput({
          clientId: "temporal",
          idempotencyKey: "idem-42",
          subject: "Temporal message",
        }),
      );
      expect(otherClient.deduplicated).toBe(false);
      expect(otherClient.message.id).not.toBe(first.message.id);

      expect(store.getReceipt("alert-dashboard", first.message.id)?.id).toBe(
        first.message.id,
      );
      expect(store.getReceipt("temporal", first.message.id)).toBeNull();
      expect(
        store.getReceipt("alert-dashboard", otherClient.message.id),
      ).toBeNull();
    } finally {
      store.close();
    }
  });

  test("counts per-client messages within rate-limit window", () => {
    const store = MailStore.open(":memory:");
    try {
      store.enqueueMessage(
        sampleEnqueueInput({
          clientId: "media",
          nowIso: "2026-11-24T11:45:00.000Z",
        }),
      );
      store.enqueueMessage(
        sampleEnqueueInput({
          clientId: "media",
          nowIso: "2026-11-24T11:55:00.000Z",
        }),
      );
      store.enqueueMessage(
        sampleEnqueueInput({
          clientId: "media",
          nowIso: "2026-11-24T11:59:00.000Z",
        }),
      );
      expect(
        store.countClientMessagesSince("media", "2026-11-24T11:50:00.000Z"),
      ).toBe(2);
      expect(
        store.countClientMessagesSince("temporal", "2026-11-24T11:50:00.000Z"),
      ).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe("MailStore crash recovery, retention pruning, and retry lifecycle", () => {
  test("recovers stranded 'sending' rows to 'retrying' on startup", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mail-store-recover-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "mail.sqlite");

    const store1 = MailStore.open(dbPath, {
      nowIso: "2026-11-24T12:00:00.000Z",
    });
    const enqueued = store1.enqueueMessage(
      sampleEnqueueInput({ nowIso: "2026-11-24T12:00:00.000Z" }),
    );
    const claimed = store1.claimNextDue("2026-11-24T12:00:01.000Z");
    expect(claimed?.id).toBe(enqueued.message.id);
    expect(store1.getMessageDetail(enqueued.message.id)?.status).toBe(
      "sending",
    );
    store1.close();

    const restartIso = "2026-11-24T12:05:00.000Z";
    const store2 = MailStore.open(dbPath, { nowIso: restartIso });
    try {
      const recovered = store2.getMessageDetail(enqueued.message.id);
      expect(recovered?.status).toBe("retrying");
      expect(recovered?.nextAttemptAt).toBe(restartIso);

      const reclaimed = store2.claimNextDue(restartIso);
      expect(reclaimed?.id).toBe(enqueued.message.id);
    } finally {
      store2.close();
    }
  });

  test("prunes expired sent and failed messages while preserving active and recent rows", () => {
    const store = MailStore.open(":memory:", {
      nowIso: "2026-11-24T12:00:00.000Z",
    });
    try {
      const oldSent = store.enqueueMessage(
        sampleEnqueueInput({
          subject: "Old sent",
          nowIso: "2026-10-01T00:00:00.000Z",
        }),
      );
      store.claimNextDue("2026-10-01T00:00:01.000Z");
      store.recordAttempt({
        messageId: oldSent.message.id,
        startedAt: "2026-10-01T00:00:01.000Z",
        finishedAt: "2026-10-01T00:00:02.000Z",
        durationMs: 1000,
        outcome: "sent",
        smtpCode: 250,
        smtpResponse: "250 Ok",
      });

      const recentFailed = store.enqueueMessage(
        sampleEnqueueInput({
          subject: "Recent failed",
          nowIso: "2026-11-23T00:00:00.000Z",
        }),
      );
      store.claimNextDue("2026-11-23T00:00:01.000Z");
      store.recordAttempt({
        messageId: recentFailed.message.id,
        startedAt: "2026-11-23T00:00:01.000Z",
        finishedAt: "2026-11-23T00:00:02.000Z",
        durationMs: 500,
        outcome: "permanent_error",
        smtpCode: 550,
        smtpResponse: "550 Rejected",
        error: "Rejected",
      });

      const oldQueued = store.enqueueMessage(
        sampleEnqueueInput({
          subject: "Old queued",
          nowIso: "2026-10-01T00:00:00.000Z",
        }),
      );

      // Enqueueing a new message triggers bounded pruneExpired(30, nowIso, 100)
      store.enqueueMessage(
        sampleEnqueueInput({
          subject: "Fresh",
          nowIso: "2026-11-24T12:00:00.000Z",
          retentionDays: 30,
        }),
      );

      expect(store.getMessageDetail(oldSent.message.id)).toBeNull();
      expect(store.getMessageDetail(oldQueued.message.id)?.status).toBe(
        "queued",
      );
      expect(store.getMessageDetail(recentFailed.message.id)?.status).toBe(
        "failed",
      );

      const retried = store.retryMessage(
        recentFailed.message.id,
        "2026-11-24T12:01:00.000Z",
      );
      expect(retried.kind).toBe("ok");
      if (retried.kind === "ok") {
        expect(retried.message.status).toBe("queued");
        expect(retried.message.failedAt).toBeNull();
        expect(retried.message.attempts).toHaveLength(1);
      }
    } finally {
      store.close();
    }
  });
});

describe("MailStore search, filtering, overview, and MIME synthesis", () => {
  test("filters by active status, clientId, tag, and substring query", () => {
    const store = MailStore.open(":memory:");
    try {
      const m1 = store.enqueueMessage(
        sampleEnqueueInput({
          clientId: "alert-dashboard",
          subject: "Disk space critical on node-1",
          tag: "disk-alert",
          rfcMessageId: "<disk-1@sjer.red>",
          nowIso: "2026-11-24T11:00:00.000Z",
        }),
      );
      const m2 = store.enqueueMessage(
        sampleEnqueueInput({
          clientId: "temporal",
          subject: "Daily homelab audit",
          toHeader: "reports@sjer.red",
          tag: "daily-report",
          rfcMessageId: "<audit-2@sjer.red>",
          nowIso: "2026-11-24T11:30:00.000Z",
        }),
      );
      store.claimNextDue("2026-11-24T11:00:01.000Z");
      store.recordAttempt({
        messageId: m1.message.id,
        startedAt: "2026-11-24T11:00:01.000Z",
        finishedAt: "2026-11-24T11:00:02.000Z",
        durationMs: 120,
        outcome: "transient_error",
        nextAttemptAt: "2026-11-24T11:10:00.000Z",
        smtpCode: 451,
        error: "Try later",
      });

      store.claimNextDue("2026-11-24T11:30:01.000Z");
      store.recordAttempt({
        messageId: m1.message.id,
        startedAt: "2026-11-24T11:30:01.000Z",
        finishedAt: "2026-11-24T11:30:02.000Z",
        durationMs: 90,
        outcome: "sent",
        smtpCode: 250,
        smtpResponse: "250 2.0.0 Ok",
      });

      const activeList = store.listMessages({ status: "active" });
      expect(activeList.total).toBe(1);
      expect(activeList.items[0]?.id).toBe(m2.message.id);

      const searchByRfcId = store.listMessages({ q: "disk-1@sjer.red" });
      expect(searchByRfcId.total).toBe(1);
      expect(searchByRfcId.items[0]?.id).toBe(m1.message.id);

      const searchByTag = store.listMessages({ tag: "daily-report" });
      expect(searchByTag.total).toBe(1);
      expect(searchByTag.items[0]?.id).toBe(m2.message.id);

      const overview = store.getOverview(
        {
          enabled: true,
          upstreamHost: "smtp.fastmail.com",
          upstreamPort: 587,
          smtpListenerPort: 2525,
          smtpTlsCertExpiresAt: null,
          retentionDays: 30,
        },
        ["alert-dashboard", "temporal", "seerr"],
        "2026-11-24T12:00:00.000Z",
      );
      expect(overview.counts.all).toBe(2);
      expect(overview.counts.sent).toBe(1);
      expect(overview.counts.sent24h).toBe(1);
      expect(overview.counts.active).toBe(1);
      expect(overview.clients.map((c) => c.clientId)).toContain("seerr");
    } finally {
      store.close();
    }
  });

  test("synthesizes canonical MIME and verifies auth/domain helpers", async () => {
    const synthesized = await synthesizeMimeMessage({
      to: ["Ops Team <ops@sjer.red>"],
      from: "Hub Alerts <alerts@sjer.red>",
      subject: "Synthetic check",
      plainBody: "Plain hello",
      htmlBody: "<p>HTML hello</p>",
      messageId: "custom-123@sjer.red",
      tag: "probe",
    });
    expect(synthesized.rfcMessageId).toBe("<custom-123@sjer.red>");
    expect(synthesized.mailFrom).toBe("alerts@sjer.red");
    expect(synthesized.recipients).toEqual(["ops@sjer.red"]);

    const parsedBack = await parseInboundMime(synthesized.rawMime);
    expect(parsedBack.fromAddress).toBe("alerts@sjer.red");
    expect(parsedBack.subject).toBe("Synthetic check");
    expect(parsedBack.plainBody?.trim()).toBe("Plain hello");
    expect(parsedBack.htmlBody?.trim()).toBe("<p>HTML hello</p>");
    expect(parsedBack.rfcMessageId).toBe("<custom-123@sjer.red>");

    expect(verifySecretConstantTime("secret-abc", "secret-abc")).toBe(true);
    expect(verifySecretConstantTime("secret-abc", "secret-xyz")).toBe(false);
    expect(verifySecretConstantTime("short", "much-longer-secret")).toBe(false);

    expect(
      isSenderDomainAllowed("Hub Alerts <alerts@SJER.RED>", {
        allowedFromDomains: ["sjer.red"],
      }),
    ).toBe(true);
    expect(
      isSenderDomainAllowed("alerts@other.example", {
        allowedFromDomains: ["*"],
      }),
    ).toBe(true);
    expect(
      isSenderDomainAllowed("alerts@other.example", {
        allowedFromDomains: ["sjer.red"],
      }),
    ).toBe(false);

    const cfg = loadMailConfig({});
    expect(cfg.port).toBe(7370);
    expect(cfg.clients).toEqual({});
    expect(authenticateBearerClient("Bearer nope", cfg.clients)).toBeNull();
  });
});
