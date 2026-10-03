import type { Client } from "@temporalio/client";
import { ApplicationFailure } from "@temporalio/common";
import { verifySpectrumSignature } from "@spectrum-ts/core/webhook";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { photonIngressConfig } from "#config/photon.ts";
import { admitPhotonMessage } from "#lib/photon/admission.ts";
import { photonCredentials } from "#lib/photon/client.ts";
import { normalizePhotonMessage } from "#lib/photon/messages.ts";
import { photonWebhookTotal } from "#observability/metrics.ts";

type Options = {
  credentials: NonNullable<ReturnType<typeof photonCredentials>> | undefined;
  config: typeof photonIngressConfig;
  admit: typeof admitPhotonMessage;
  now: () => string;
};
function failureType(error: unknown): string | undefined {
  if (error instanceof ApplicationFailure) return error.type ?? undefined;
  return error instanceof Error && error.cause !== undefined
    ? failureType(error.cause)
    : undefined;
}
export function buildPhotonWebhookRoutes(client: Client, overrides?: Options) {
  const options = overrides ?? {
    credentials: photonCredentials(),
    config: photonIngressConfig,
    admit: admitPhotonMessage,
    now: () => new Date().toISOString(),
  };
  const app = new Hono();
  app.use("/webhooks/photon", bodyLimit({ maxSize: 128_000 }));
  app.post("/webhooks/photon", async (c) => {
    const reply = (outcome: string, status: 200 | 400 | 401 | 409 | 503) => {
      photonWebhookTotal.inc({ outcome });
      return c.json({ status: outcome }, status);
    };
    const credentials = options.credentials;
    if (credentials === undefined) return reply("unconfigured", 503);
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    const now = options.now();
    const verified = await verifySpectrumSignature({
      rawBody,
      headers: c.req.header(),
      secret: credentials.webhookSecret,
      now: Date.parse(now),
    });
    if (!verified.ok) return reply("unauthorized", 401);
    let config;
    try {
      config = await options.config();
    } catch {
      return reply("configuration-unavailable", 503);
    }
    if (!config.sourceAvailable) return reply("configuration-unavailable", 503);
    if (!config.enabled) return reply("disabled", 200);
    let message;
    try {
      message = normalizePhotonMessage(
        JSON.parse(new TextDecoder().decode(rawBody)),
        credentials.projectId,
        config.owners,
        now,
      );
    } catch {
      return reply("invalid", 400);
    }
    if (message === undefined) return reply("ignored", 200);
    try {
      // Native SDK app.webhook() ACKs before its handler finishes. Use its
      // verifier but await durable admission ourselves before returning 200.
      const admission = await options.admit(client.workflow, message);
      return reply(admission.status, 200);
    } catch (error: unknown) {
      return failureType(error) === "PhotonMessageConflict"
        ? reply("conflict", 409)
        : reply("admission-unavailable", 503);
    }
  });
  return app;
}
