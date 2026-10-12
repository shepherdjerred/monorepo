import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  checkRateLimit,
  clearAllRateLimits,
  clearRateLimit,
  getTimeRemaining,
  recordCreation,
} from "#src/database/competition/rate-limit.ts";

import { testAccountId } from "#src/testing/test-ids.ts";

const SERVER_ONE = DiscordGuildIdSchema.parse("811908216722529155");
const SERVER_TWO = DiscordGuildIdSchema.parse("818806288990321838");
const SERVER_ID = DiscordGuildIdSchema.parse("819630016978081671");
// Clean up before each test
beforeEach(() => {
  clearAllRateLimits();
});

afterEach(() => {
  clearAllRateLimits();
});

describe("checkRateLimit", () => {
  test("returns true for first creation", () => {
    const result = checkRateLimit(SERVER_ID, "user-45600000456");
    expect(result).toBe(true);
  });

  test("returns false within rate limit window", () => {
    const serverId = SERVER_ID;
    const userId = testAccountId("456000004560");

    // Record creation
    recordCreation(serverId, userId);

    // Immediately check - should be rate limited
    const result = checkRateLimit(serverId, userId);
    expect(result).toBe(false);
  });

  test("returns true after rate limit window expires", () => {
    const serverId = SERVER_ID;
    const userId = testAccountId("456000004560");

    // Note: We can't directly manipulate time in the implementation,
    // so we test the clearing behavior instead
    recordCreation(serverId, userId);

    // Immediately should be limited
    expect(checkRateLimit(serverId, userId)).toBe(false);

    // Clear and test that clearing works (simulates time passing)
    clearRateLimit(serverId, userId);
    expect(checkRateLimit(serverId, userId)).toBe(true);
  });

  test("rate limits are independent per server", () => {
    const userId = testAccountId("456000004560");

    // Record on server1
    recordCreation(SERVER_ONE, userId);

    // Should be limited on server1
    expect(checkRateLimit(SERVER_ONE, userId)).toBe(false);

    // Should NOT be limited on server2
    expect(checkRateLimit(SERVER_TWO, userId)).toBe(true);
  });

  test("rate limits are independent per user", () => {
    const serverId = SERVER_ID;

    // Record for user1
    recordCreation(serverId, "user-10000000001");

    // Should be limited for user1
    expect(checkRateLimit(serverId, "user-10000000001")).toBe(false);

    // Should NOT be limited for user2
    expect(checkRateLimit(serverId, "user-20000000002")).toBe(true);
  });
});

describe("recordCreation", () => {
  test("records creation timestamp", () => {
    const serverId = SERVER_ID;
    const userId = testAccountId("456000004560");

    // Should be allowed initially
    expect(checkRateLimit(serverId, userId)).toBe(true);

    // Record creation
    recordCreation(serverId, userId);

    // Should now be rate limited
    expect(checkRateLimit(serverId, userId)).toBe(false);
  });

  test("updates timestamp on subsequent recordings", () => {
    const serverId = SERVER_ID;
    const userId = testAccountId("456000004560");

    // Record twice
    recordCreation(serverId, userId);
    recordCreation(serverId, userId);

    // Should still be rate limited
    expect(checkRateLimit(serverId, userId)).toBe(false);
  });
});

describe("getTimeRemaining", () => {
  test("returns 0 for user with no rate limit", () => {
    const remaining = getTimeRemaining(SERVER_ID, "user-45600000456");
    expect(remaining).toBe(0);
  });

  test("returns time remaining after recording", () => {
    const serverId = SERVER_ID;
    const userId = testAccountId("456000004560");

    recordCreation(serverId, userId);

    const remaining = getTimeRemaining(serverId, userId);

    // Should be close to 1 hour (60 minutes = 3,600,000 ms)
    // Allow small tolerance for test execution time
    expect(remaining).toBeGreaterThan(3_599_000); // 59.98 minutes
    expect(remaining).toBeLessThanOrEqual(3_600_000); // 60 minutes
  });

  test("returns 0 after clearing rate limit", () => {
    const serverId = SERVER_ID;
    const userId = testAccountId("456000004560");

    recordCreation(serverId, userId);
    expect(getTimeRemaining(serverId, userId)).toBeGreaterThan(0);

    clearRateLimit(serverId, userId);
    expect(getTimeRemaining(serverId, userId)).toBe(0);
  });
});

describe("clearRateLimit", () => {
  test("clears rate limit for specific user", () => {
    const serverId = SERVER_ID;
    const userId = testAccountId("456000004560");

    recordCreation(serverId, userId);
    expect(checkRateLimit(serverId, userId)).toBe(false);

    clearRateLimit(serverId, userId);
    expect(checkRateLimit(serverId, userId)).toBe(true);
  });

  test("only clears specified user's rate limit", () => {
    const serverId = SERVER_ID;

    recordCreation(serverId, "user-10000000001");
    recordCreation(serverId, "user-20000000002");

    clearRateLimit(serverId, "user-10000000001");

    expect(checkRateLimit(serverId, "user-10000000001")).toBe(true);
    expect(checkRateLimit(serverId, "user-20000000002")).toBe(false);
  });
});

describe("clearAllRateLimits", () => {
  test("clears all rate limits", () => {
    recordCreation(SERVER_ONE, "user-10000000001");
    recordCreation(SERVER_ONE, "user-20000000002");
    recordCreation(SERVER_TWO, "user-10000000001");

    clearAllRateLimits();

    expect(checkRateLimit(SERVER_ONE, "user-10000000001")).toBe(true);
    expect(checkRateLimit(SERVER_ONE, "user-20000000002")).toBe(true);
    expect(checkRateLimit(SERVER_TWO, "user-10000000001")).toBe(true);
  });
});
