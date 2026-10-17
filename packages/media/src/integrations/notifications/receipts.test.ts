import { expect, test } from "vitest";
import { createNotificationReceiptReader } from "./receipts.ts";
import { createHash } from "node:crypto";
const config = {
  postal: {
    baseUrl: "http://postal.fixture",
    apiKey: "fixture",
    from: "media@example.test",
  },
};
test("Postal reads only exact receipt status and validates the original attempt tag", async () => {
  let tag = "media-attempt";
  let status = "Sent";
  const read = createNotificationReceiptReader(config, async (url, init) => {
    expect(url.pathname).toBe("/api/v1/messages/message");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({ id: 42, _expansions: ["status", "details"] }),
    );
    return Response.json({
      status: "success",
      data: {
        id: 42,
        status: { status, held: false },
        details: {
          rcpt_to: "fixture@example.test",
          tag,
          direction: "outgoing",
          bounce: false,
        },
      },
    });
  });
  const input = {
    channel: "email" as const,
    receipt: "message-id:42",
    idempotencyKey: "attempt",
  };
  expect(await read(input)).toEqual({
    status: "delivered",
    recipient: "fixture@example.test",
  });
  status = "HardFail";
  expect(await read(input)).toMatchObject({ status: "bounced" });
  tag = "other-attempt";
  expect(await read(input)).toEqual({ status: "unknown", recipient: null });
});
test("missing provider receipt remains unknown and missing credentials remain explicit", async () => {
  const read = createNotificationReceiptReader(config, async () =>
    Response.json({ status: "error", data: { code: "MessageNotFound" } }),
  );
  expect(
    await read({ channel: "email", receipt: "42", idempotencyKey: "attempt" }),
  ).toEqual({ status: "unknown", recipient: null });
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
