import { expect, test } from "vitest";
import { createNotificationTransport } from "./notification-transport.ts";

const message = {
  channel: "email",
  recipient: "fixture@example.com",
  subject: "Fixture",
  text: "Fixture body",
  idempotencyKey: "notification1",
} satisfies Parameters<ReturnType<typeof createNotificationTransport>>[0];

test("Mail acceptance sends Bearer auth without Host override and returns message id", async () => {
  const config = {
    mail: {
      baseUrl: "https://mail.example.com",
      token: "fixture-secret",
      from: "media@example.com",
    },
  };
  const send = createNotificationTransport(config, async (url, init) => {
    expect(url.pathname).toBe("/v1/messages");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer fixture-secret");
    expect(headers.get("host")).toBeNull();
    if (typeof init.body !== "string")
      throw new TypeError("Expected JSON body");
    expect(JSON.parse(init.body)).toEqual({
      to: ["fixture@example.com"],
      from: "media@example.com",
      subject: "Fixture",
      plainBody: "Fixture body",
      tag: "media-notification1",
      idempotencyKey: "notification1",
    });
    return Response.json(
      {
        id: "msg_42",
        rfcMessageId: "<msg-42@example.com>",
        status: "queued",
        deduplicated: false,
      },
      { status: 202 },
    );
  });
  await expect(send(message)).resolves.toEqual({ receipt: "msg_42" });

  const rejected = createNotificationTransport(config, async () =>
    Response.json({ error: "Invalid message request" }, { status: 400 }),
  );
  await expect(rejected(message)).rejects.toMatchObject({
    service: "mail",
    kind: "interaction-required",
    status: 400,
  });

  const ambiguous = createNotificationTransport(config, async () =>
    Response.json({ id: "" }, { status: 200 }),
  );
  await expect(ambiguous(message)).rejects.toMatchObject({
    service: "mail",
    kind: "outcome-unknown",
  });
});

test("Discord creates the linked user's DM and disables mention expansion", async () => {
  const send = createNotificationTransport(
    { discord: { botToken: "fixture-secret" } },
    async (url, init) => {
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bot fixture-secret",
      );
      if (url.pathname.endsWith("users/@me/channels")) {
        expect(init.body).toBe(JSON.stringify({ recipient_id: "123" }));
        return Response.json({ id: "456" });
      }
      expect(url.pathname).toBe("/api/v10/channels/456/messages");
      if (typeof init.body !== "string")
        throw new TypeError("Expected JSON body");
      expect(JSON.parse(init.body)).toMatchObject({
        allowed_mentions: { parse: [] },
        enforce_nonce: true,
      });
      return Response.json({ id: "789" });
    },
  );
  await expect(
    send({ ...message, channel: "discord", recipient: "123" }),
  ).resolves.toEqual({ receipt: "discord:456:789" });
  await expect(createNotificationTransport({})(message)).rejects.toMatchObject({
    kind: "interaction-required",
  });
});
