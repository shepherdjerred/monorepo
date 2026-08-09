/**
 * Translation of Discord upstream failures into tRPC errors.
 *
 * The rule: an unreachable Discord is NEVER `FORBIDDEN`. Reporting an outage as
 * "You are not a member of that guild" tells the user they lack permission, so
 * they never retry or re-authenticate — which is the confusion this replaces.
 */

import { describe, it, expect } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import { toTrpcError } from "#src/trpc/discord-upstream.ts";

describe("toTrpcError", () => {
  it("maps a lost Discord grant to UNAUTHORIZED", () => {
    const mapped = toTrpcError(
      new DiscordUpstreamError("token_refresh_failed", "revoked"),
    );

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("UNAUTHORIZED");
    // Signing in again is the action that actually fixes this one.
    expect(mapped.message).toContain("sign in again");
  });

  it.each([
    ["fetch_error"],
    ["http_error"],
    ["parse_error"],
    ["schema_error"],
  ] as const)("maps %s to a retryable SERVICE_UNAVAILABLE", (reason) => {
    const mapped = toTrpcError(new DiscordUpstreamError(reason, "upstream"));

    expect(mapped.code).toBe("SERVICE_UNAVAILABLE");
    expect(mapped.message).toContain("Couldn't reach Discord");
  });

  it("never produces FORBIDDEN for any upstream reason", () => {
    const reasons = [
      "token_refresh_failed",
      "fetch_error",
      "http_error",
      "parse_error",
      "schema_error",
    ] as const;

    for (const reason of reasons) {
      const mapped = toTrpcError(new DiscordUpstreamError(reason, "x"));
      expect(mapped.code).not.toBe("FORBIDDEN");
      expect(mapped.message).not.toContain("not a member");
    }
  });

  it("preserves the original error as the cause for debugging", () => {
    const original = new DiscordUpstreamError("http_error", "boom", 503);
    expect(toTrpcError(original).cause).toBe(original);
  });
});
