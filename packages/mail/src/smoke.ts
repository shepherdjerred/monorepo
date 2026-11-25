import { SendMessageResponseSchema } from "./shared/contract.ts";
import { startMailServer } from "./server/server.ts";

const SMOKE_TOKEN = "smoke-mail-client-token-00000000";

const server = await startMailServer({
  env: {
    HOST: "127.0.0.1",
    PORT: "0",
    MAIL_API_PORT: "0",
    MAIL_SMTP_PORT: "0",
    MAIL_DATABASE_PATH: "/tmp/mail-smoke.sqlite",
    MAIL_CLIENTS_JSON: JSON.stringify({
      smoke: {
        token: SMOKE_TOKEN,
        allowedFromDomains: ["sjer.red"],
      },
    }),
    FASTMAIL_SMTP_HOST: "127.0.0.1",
    FASTMAIL_SMTP_PORT: "15587",
    FASTMAIL_SMTP_USERNAME: "smoke@sjer.red",
    FASTMAIL_SMTP_PASSWORD: "smoke-password",
    FEATURE_FLAGS_MODE: "disabled",
    MAIL_RELAY_ENABLED_FALLBACK: "false",
  },
});

try {
  const adminBase = `http://127.0.0.1:${String(server.port)}`;
  const apiBase = `http://127.0.0.1:${String(server.apiPort)}`;

  const [health, ready, metrics, page] = await Promise.all([
    fetch(`${adminBase}/healthz`),
    fetch(`${adminBase}/readyz`),
    fetch(`${adminBase}/metrics`),
    fetch(`${adminBase}/`),
  ]);

  const html = await page.text();
  if (
    !health.ok ||
    !ready.ok ||
    !metrics.ok ||
    !page.ok ||
    !html.includes('<div id="root"></div>')
  ) {
    throw new Error("Admin endpoints or SPA index check failed");
  }

  const assetPath = /src="([^"]+\.js)"/u.exec(html)?.[1];
  if (assetPath === undefined) {
    throw new Error("Bundled client JS asset path missing from index.html");
  }
  const assetRes = await fetch(new URL(assetPath, page.url));
  if (!assetRes.ok) {
    throw new Error("Bundled client JS asset failed to serve");
  }

  const sendRes = await fetch(`${apiBase}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SMOKE_TOKEN}`,
    },
    body: JSON.stringify({
      to: ["ops@sjer.red"],
      from: "Smoke <alerts@sjer.red>",
      subject: "Smoke probe",
      plainBody: "hello",
      idempotencyKey: "smoke-1",
    }),
  });
  if (sendRes.status !== 202) {
    throw new Error(
      `Expected 202 from POST /v1/messages, got ${String(sendRes.status)}`,
    );
  }

  const sent = SendMessageResponseSchema.parse(await sendRes.json());
  const receiptRes = await fetch(`${apiBase}/v1/messages/${sent.id}`, {
    headers: { authorization: `Bearer ${SMOKE_TOKEN}` },
  });
  if (!receiptRes.ok) {
    throw new Error(
      `Expected 200 from GET /v1/messages/:id, got ${String(receiptRes.status)}`,
    );
  }
} finally {
  await server.stop(true);
}
