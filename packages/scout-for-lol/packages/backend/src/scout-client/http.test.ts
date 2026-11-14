import { beforeEach, expect, test } from "vitest";
import {
  SCOUT_CLIENT_MAX_BATCH_BYTES,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  SCOUT_DESKTOP_CONTRACT_VERSION,
  ScoutDesktopApiErrorSchema,
} from "@scout-for-lol/data";
import { handleScoutClientRoute } from "./http.ts";
import { resetPairingRateLimitForTests } from "./pairing-rate-limit.ts";

beforeEach(() => resetPairingRateLimitForTests());

const makePairingRequest = () =>
  new Request("https://scout.invalid/api/scout-client/v1/pairings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.20",
    },
    body: "{}",
  });

test("chunked JSON is rejected before buffering beyond the ingress limit", async () => {
  const chunkBytes = Math.floor(SCOUT_CLIENT_MAX_BATCH_BYTES / 2) + 1;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(chunkBytes));
      controller.enqueue(new Uint8Array(chunkBytes));
      controller.close();
    },
  });
  const request = new Request(
    "https://scout.invalid/api/scout-client/v1/pairings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
  const response = await handleScoutClientRoute(request, new URL(request.url));
  expect(response?.status).toBe(413);
});

test("pairing creation is rate-limited before database work", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const request = makePairingRequest();
    const response = await handleScoutClientRoute(
      request,
      new URL(request.url),
    );
    expect(response?.status).toBe(400);
  }
  const rejected = makePairingRequest();
  const response = await handleScoutClientRoute(
    rejected,
    new URL(rejected.url),
  );
  expect(response?.status).toBe(429);
  expect(response?.headers.get("Retry-After")).toBe("60");
});

const makeV2 = () =>
  new Request(
    `https://scout.invalid${SCOUT_DESKTOP_API_ROUTES.pairings_v2.path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.30",
        [SCOUT_DESKTOP_CONTRACT_HEADER]: String(SCOUT_DESKTOP_CONTRACT_VERSION),
      },
      body: "{}",
    },
  );

test("v2 pairing refusals use the desktop error contract", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const request = makeV2();
    const response = await handleScoutClientRoute(
      request,
      new URL(request.url),
    );
    expect(response?.status).toBe(400);
    expect(ScoutDesktopApiErrorSchema.parse(await response?.json()).error).toBe(
      "invalid_request",
    );
  }
  const rejected = makeV2();
  const response = await handleScoutClientRoute(
    rejected,
    new URL(rejected.url),
  );
  expect(response?.status).toBe(429);
  expect(ScoutDesktopApiErrorSchema.parse(await response?.json()).error).toBe(
    "rate_limited",
  );
});
