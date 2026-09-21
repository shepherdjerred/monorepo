import { beforeEach, describe, expect, test } from "vitest";
import {
  pairingCreationAllowed,
  resetPairingRateLimitForTests,
} from "./pairing-rate-limit.ts";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

function request(ip?: string): Request {
  return new Request("https://scout.invalid/api/scout-client/v1/pairings", {
    headers: ip === undefined ? {} : { "CF-Connecting-IP": ip },
  });
}

describe("pairing creation limiter", () => {
  beforeEach(() => resetPairingRateLimitForTests(NOW));

  test("limits each anonymous edge caller", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(pairingCreationAllowed(request("192.0.2.10"), NOW)).toBe(true);
    }
    expect(pairingCreationAllowed(request("192.0.2.10"), NOW)).toBe(false);
    expect(pairingCreationAllowed(request("192.0.2.11"), NOW)).toBe(true);
  });

  test("resets the fixed window after one minute", () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      pairingCreationAllowed(request(), NOW);
    }
    expect(pairingCreationAllowed(request(), NOW)).toBe(false);
    expect(pairingCreationAllowed(request(), NOW + 60_000)).toBe(true);
  });
});
