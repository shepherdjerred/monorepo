import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createNotificationTransport } from "./notification-transport.ts";

const message = {
  channel: "email",
  recipient: "fixture@example.com",
  subject: "Fixture",
  text: "Fixture body",
  idempotencyKey: "notification1",
} satisfies Parameters<ReturnType<typeof createNotificationTransport>>[0];
test("Postal acceptance requires successful envelope and the exact recipient receipt", async () => {
  const config = {
    postal: {
      baseUrl: "https://postal.example.com",
      apiKey: "fixture-secret",
      from: "media@example.com",
      hostHeader: "postal.fixture.internal",
    },
  };
  const send = createNotificationTransport(config, async (url, init) => {
    expect(url.pathname).toBe("/api/v1/send/message");
    expect(new Headers(init.headers).get("X-Server-API-Key")).toBe(
      "fixture-secret",
    );
    expect(new Headers(init.headers).get("host")).toBe(
      "postal.fixture.internal",
    );
    return Response.json({
      status: "success",
      data: {
        message_id: "fixture-id",
        messages: { "fixture@example.com": { id: 42 } },
      },
    });
  });
  await expect(send(message)).resolves.toEqual({ receipt: "fixture-id:42" });
  const rejected = createNotificationTransport(config, async () =>
    Response.json({ status: "error", data: { message: "sensitive details" } }),
  );
  await expect(rejected(message)).rejects.toMatchObject({
    kind: "interaction-required",
  });
  const ambiguous = createNotificationTransport(config, async () =>
    Response.json({
      status: "success",
      data: { message_id: "fixture-id", messages: {} },
    }),
  );
  await expect(ambiguous(message)).rejects.toMatchObject({
    kind: "outcome-unknown",
  });
});

test("the Node worker fetch preserves Postal's virtual host override", async () => {
  await promisify(execFile)(
    "node",
    [fileURLToPath(new URL("postal-host.fixture.ts", import.meta.url))],
    { timeout: 10_000 },
  );
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
