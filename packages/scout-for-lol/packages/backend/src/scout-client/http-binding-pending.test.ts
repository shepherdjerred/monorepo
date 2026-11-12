import { expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  ScoutClientObservationSchema,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type * as Ingress from "./ingress.ts";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  ingest: vi.fn(),
  start: vi.fn(),
}));
vi.mock("./authentication.ts", () => ({
  authenticateScoutClient: mocks.authenticate,
}));
vi.mock("./ingress.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Ingress>()),
  ingestObservationBatch: mocks.ingest,
  startAcceptedClientMatches: mocks.start,
}));

const { handleScoutClientRoute } = await import("./http.ts");
const { ClientBindingReconciliationPending } =
  await import("./late-binding.ts");

const riotMatchId = RiotMatchIdSchema.parse("NA1_7101");
const observation = ScoutClientObservationSchema.parse({
  protocolVersion: 1,
  schemaVersion: 1,
  observationId: crypto.randomUUID(),
  sequence: 1,
  capturedAt: new Date().toISOString(),
  appVersion: "0.1.0",
  kind: "post_game",
  platformId: "NA1",
  localPuuid: LeaguePuuidSchema.parse("p".repeat(78)),
  gameId: "7101",
  payload: { resource: "post_game", data: {} },
});

test("a pending late binding answers a retryable 503 instead of throwing", async () => {
  mocks.authenticate.mockResolvedValue({
    deviceId: "device-1",
    ownerId: DiscordAccountIdSchema.parse("160509172704739328"),
    appVersion: "0.1.0",
  });
  mocks.ingest.mockResolvedValue([
    { observationId: observation.observationId, outcome: "accepted" },
  ]);
  mocks.start.mockRejectedValue(
    new ClientBindingReconciliationPending(riotMatchId),
  );
  const request = new Request(
    "https://scout.invalid/api/scout-client/v1/observations/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observations: [observation] }),
    },
  );

  const response = await handleScoutClientRoute(request, new URL(request.url));

  expect(mocks.start).toHaveBeenCalledOnce();
  expect(response?.status).toBe(503);
  expect(response?.headers.get("Retry-After")).toBe("5");
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
  expect(await response?.json()).toEqual({
    error: "binding_reconciliation_pending",
    message: `Match pipeline ${riotMatchId} is still applying binding-dependent stages; retry reconciliation`,
  });
});

test("an unexpected ingress failure still propagates to the server error path", async () => {
  mocks.authenticate.mockResolvedValue({
    deviceId: "device-1",
    ownerId: DiscordAccountIdSchema.parse("160509172704739328"),
    appVersion: "0.1.0",
  });
  mocks.ingest.mockResolvedValue([]);
  mocks.start.mockRejectedValue(new Error("Temporal is unavailable"));
  const request = new Request(
    "https://scout.invalid/api/scout-client/v1/observations/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observations: [observation] }),
    },
  );

  await expect(
    handleScoutClientRoute(request, new URL(request.url)),
  ).rejects.toThrow("Temporal is unavailable");
});
