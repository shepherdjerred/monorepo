import { createHmac } from "node:crypto";
import type { Client } from "@temporalio/client";
import { ApplicationFailure } from "@temporalio/common";
import { describe, expect, test, vi } from "vitest";
import {
  photonEnvelope,
  PHOTON_NOW,
} from "#lib/photon/fixtures.test-support.ts";
import { buildPhotonWebhookRoutes } from "./photon.ts";
import type { PhotonAdmission } from "#shared/agent/agent-chat-photon.ts";

const credentials = {
  projectId: "project",
  projectSecret: "test-project-credential",
  webhookSecret: "test-webhook-credential",
};
const client: Client = Object.create(null);
const timestamp = String(Date.parse(PHOTON_NOW) / 1000);
function headers(body: string, time = timestamp) {
  return {
    "content-type": "application/json",
    "x-spectrum-timestamp": time,
    "x-spectrum-signature": `v0=${createHmac("sha256", credentials.webhookSecret).update(`v0:${time}:`).update(body).digest("hex")}`,
  };
}
function setup() {
  const config = vi.fn(async () => ({
    sourceAvailable: true,
    enabled: true,
    owners: ["+15550000001"],
  }));
  const admit = vi.fn(async (): Promise<PhotonAdmission> => ({
    status: "accepted",
    pending: 1,
  }));
  const app = buildPhotonWebhookRoutes(client, {
    credentials,
    config,
    admit,
    now: () => PHOTON_NOW,
  });
  const request = (value: unknown = photonEnvelope()) => {
    const body = JSON.stringify(value);
    return app.request("/webhooks/photon", {
      method: "POST",
      headers: headers(body),
      body,
    });
  };
  return { app, config, admit, request };
}
async function status(response: Response | Promise<Response>) {
  const result = await response;
  return result.status;
}
describe("signed Photon webhook admission", () => {
  test("awaits Temporal admission before acknowledging a valid raw-byte signature", async () => {
    const { app, admit } = setup();
    let settle: (() => void) | undefined;
    const entered = Promise.withResolvers<undefined>();
    admit.mockImplementation(async () => {
      entered.resolve(undefined);
      await new Promise<void>((resolve) => {
        settle = resolve;
      });
      return { status: "accepted", pending: 1 };
    });
    const body = JSON.stringify(photonEnvelope(), null, 2);
    let acknowledged = false;
    const response = Promise.resolve(
      app.request("/webhooks/photon", {
        method: "POST",
        headers: headers(body),
        body,
      }),
    ).then((result) => {
      acknowledged = true;
      return result;
    });
    await entered.promise;
    expect(acknowledged).toBe(false);
    if (settle === undefined) throw new Error("Missing admission completion");
    settle();
    expect(await status(response)).toBe(200);
    expect(admit).toHaveBeenCalledOnce();
  });
  test("rejects modified payloads, missing signatures and expired/future signatures", async () => {
    const { app, admit } = setup();
    const body = JSON.stringify(photonEnvelope());
    for (const input of [
      { body: body + " ", headers: headers(body) },
      { body, headers: {} },
      { body, headers: headers(body, String(Number(timestamp) - 301)) },
      { body, headers: headers(body, String(Number(timestamp) + 301)) },
    ])
      expect(
        await status(
          app.request("/webhooks/photon", { method: "POST", ...input }),
        ),
      ).toBe(401);
    expect(admit).not.toHaveBeenCalled();
  });
  test("retries unavailable configuration and Temporal but acknowledges disabled/ignored deliveries", async () => {
    const { config, admit, request } = setup();
    config.mockResolvedValueOnce({
      sourceAvailable: false,
      enabled: false,
      owners: [],
    });
    expect(await status(request())).toBe(503);
    config.mockResolvedValueOnce({
      sourceAvailable: true,
      enabled: false,
      owners: [],
    });
    expect(await status(request())).toBe(200);
    expect(await status(request({ event: "future-event" }))).toBe(200);
    expect(admit).not.toHaveBeenCalled();
    admit.mockRejectedValueOnce(new Error("Temporal unavailable"));
    expect(await status(request())).toBe(503);
    admit.mockRejectedValueOnce(
      ApplicationFailure.nonRetryable("full", "PhotonQueueFull"),
    );
    expect(await status(request())).toBe(503);
    admit.mockRejectedValueOnce(
      new Error("update failed", {
        cause: ApplicationFailure.nonRetryable(
          "conflict",
          "PhotonMessageConflict",
        ),
      }),
    );
    expect(await status(request())).toBe(409);
    admit.mockResolvedValueOnce({ status: "duplicate", pending: 1 });
    const duplicate = await request();
    expect(await duplicate.json()).toEqual({ status: "duplicate" });
  });
  test("rejects malformed signed JSON and oversized bodies", async () => {
    const { app, request, admit } = setup();
    expect(await status(request({ event: "messages" }))).toBe(400);
    const body = "{";
    expect(
      await status(
        app.request("/webhooks/photon", {
          method: "POST",
          headers: headers(body),
          body,
        }),
      ),
    ).toBe(400);
    const huge = "x".repeat(128_001);
    expect(
      await status(
        app.request("/webhooks/photon", {
          method: "POST",
          headers: headers(huge),
          body: huge,
        }),
      ),
    ).toBe(413);
    expect(admit).not.toHaveBeenCalled();
  });
});
