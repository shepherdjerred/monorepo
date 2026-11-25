import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { createNotificationReceiptReader } from "./receipts.ts";

const config = {
  mail: {
    baseUrl: "http://mail.fixture",
    token: "fixture",
    from: "media@example.test",
  },
};

test("Mail reads exact receipt status and validates the original attempt tag and single recipient", async () => {
  let tag: string | null = "media-attempt";
  let status: "queued" | "sending" | "retrying" | "sent" | "failed" = "sent";
  let recipients = ["fixture@example.test"];
  const read = createNotificationReceiptReader(config, async (url, init) => {
    expect(url.pathname).toBe("/v1/messages/msg_42");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer fixture",
    );
    return Response.json({
      id: "msg_42",
      rfcMessageId: "<msg-42@example.test>",
      status,
      recipients,
      tag,
      createdAt: "2026-11-25T00:00:00.000Z",
      sentAt: status === "sent" ? "2026-11-25T00:00:01.000Z" : null,
      failedAt: status === "failed" ? "2026-11-25T00:00:01.000Z" : null,
      lastSmtpCode: 250,
      error: null,
    });
  });
  const input = {
    channel: "email" as const,
    receipt: "msg_42",
    idempotencyKey: "attempt",
  };
  expect(await read(input)).toEqual({
    status: "delivered",
    recipient: "fixture@example.test",
  });
  for (const active of ["queued", "sending", "retrying"] as const) {
    status = active;
    expect(await read(input)).toEqual({
      status: "accepted",
      recipient: "fixture@example.test",
    });
  }
  status = "failed";
  expect(await read(input)).toMatchObject({ status: "bounced" });
  tag = "other-attempt";
  expect(await read(input)).toEqual({ status: "unknown", recipient: null });
  tag = "media-attempt";
  recipients = ["fixture@example.test", "other@example.test"];
  expect(await read(input)).toEqual({ status: "unknown", recipient: null });
});

test("missing or legacy provider receipts remain unknown and missing credentials remain explicit", async () => {
  let requests = 0;
  const read = createNotificationReceiptReader(config, async () => {
    requests += 1;
    return Response.json({ error: "Message not found" }, { status: 404 });
  });
  expect(
    await read({
      channel: "email",
      receipt: "msg_missing",
      idempotencyKey: "attempt",
    }),
  ).toEqual({ status: "unknown", recipient: null });
  expect(requests).toBe(1);
  expect(
    await read({
      channel: "email",
      receipt: "legacy-postal:42",
      idempotencyKey: "attempt",
    }),
  ).toEqual({ status: "unknown", recipient: null });
  expect(requests).toBe(1);
  await expect(
    createNotificationReceiptReader({})({
      channel: "email",
      receipt: "msg_42",
      idempotencyKey: "attempt",
    }),
  ).rejects.toMatchObject({ service: "mail", kind: "interaction-required" });
  await expect(
    createNotificationReceiptReader({})({
      channel: "discord",
      receipt: "discord:1:2",
      idempotencyKey: "attempt",
    }),
  ).rejects.toMatchObject({ kind: "interaction-required" });
});

test("Discord receipts require the exact bot, message, nonce and DM recipient", async () => {
  let author = "10";
  let nonce = createHash("sha256").update("attempt").digest("hex").slice(0, 24);
  const requests: string[] = [];
  const read = createNotificationReceiptReader(
    { discord: { botToken: "fixture" } },
    async (url, init) => {
      expect(init.method).toBe("GET");
      requests.push(url.pathname);
      if (url.pathname.endsWith("@me"))
        return Response.json({ id: "10", bot: true });
      if (url.pathname.endsWith("messages/2"))
        return Response.json({
          id: "2",
          channel_id: "1",
          author: { id: author, bot: true },
          nonce,
        });
      return Response.json({ id: "1", type: 1, recipients: [{ id: "20" }] });
    },
  );
  const input = {
    channel: "discord" as const,
    receipt: "discord:1:2",
    idempotencyKey: "attempt",
  };
  expect(await read(input)).toEqual({ status: "accepted", recipient: "20" });
  expect(requests).toHaveLength(3);
  author = "11";
  expect(await read(input)).toEqual({ status: "unknown", recipient: null });
  author = "10";
  nonce = "another-attempt";
  expect(await read(input)).toEqual({ status: "unknown", recipient: null });
});
