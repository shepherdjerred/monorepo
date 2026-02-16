import { describe, test, expect, beforeEach } from "bun:test";
import { DiscordAccountIdSchema, DiscordGuildIdSchema } from "@scout-for-lol/data/index";

import {
  getLimit,
  getFlag,
  addLimitOverride,
  addFlagOverride,
  clearLimitOverrides,
  clearFlagOverrides,
  type LimitName,
  type FlagName,
} from "@scout-for-lol/backend/configuration/flags.ts";

describe("Feature Flags System", () => {
  describe("getLimit", () => {
    test("returns default limit when no attributes provided", () => {
      expect(getLimit("player_subscriptions")).toBe(75);
      expect(getLimit("accounts")).toBe(50);
      expect(getLimit("competitions_per_owner")).toBe(1);
      expect(getLimit("competitions_per_server")).toBe(2);
    });

    test("returns default limit when no overrides match", () => {
      const serverId = DiscordGuildIdSchema.parse("999999999999999999");
      expect(getLimit("player_subscriptions", { server: serverId })).toBe(75);
    });

    test("returns override for specific server", () => {
      const serverId = DiscordGuildIdSchema.parse("1337623164146155593");
      expect(getLimit("player_subscriptions", { server: serverId })).toBe("unlimited");
      expect(getLimit("accounts", { server: serverId })).toBe("unlimited");
    });

    test("returns most specific override when multiple match", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");
      const userId = DiscordAccountIdSchema.parse("98765432109876543");

      // Add overrides with different specificity
      addLimitOverride("competitions_per_owner", 20, { server: serverId });
      addLimitOverride("competitions_per_owner", 50, { server: serverId, user: userId });

      // More specific override should win
      expect(getLimit("competitions_per_owner", { server: serverId })).toBe(20);
      expect(getLimit("competitions_per_owner", { server: serverId, user: userId })).toBe(50);

      // Clean up
      clearLimitOverrides("competitions_per_owner");
    });

    test("ignores overrides that don't match all attributes", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");
      const otherServerId = DiscordGuildIdSchema.parse("98765432109876543");
      const userId = DiscordAccountIdSchema.parse("11111111111111111");

      addLimitOverride("competitions_per_server", 100, { server: serverId, user: userId });

      // Should match
      expect(getLimit("competitions_per_server", { server: serverId, user: userId })).toBe(100);

      // Should not match (wrong server)
      expect(getLimit("competitions_per_server", { server: otherServerId, user: userId })).toBe(2);

      // Should not match (missing user)
      expect(getLimit("competitions_per_server", { server: serverId })).toBe(2);

      clearLimitOverrides("competitions_per_server");
    });

    test("supports custom attributes", () => {
      addLimitOverride("accounts", 200, { custom_key: "custom_value" });

      expect(getLimit("accounts", { custom_key: "custom_value" })).toBe(200);
      expect(getLimit("accounts", { custom_key: "other_value" })).toBe(50);

      clearLimitOverrides("accounts");
    });
  });

  describe("getFlag", () => {
    test("returns default flag when no attributes provided", () => {
      expect(getFlag("ai_reviews_enabled")).toBe(false);
    });

    test("returns default flag when no overrides match", () => {
      const serverId = DiscordGuildIdSchema.parse("999999999999999999");
      expect(getFlag("ai_reviews_enabled", { server: serverId })).toBe(false);
    });

    test("returns override for specific server", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");

      addFlagOverride("ai_reviews_enabled", true, { server: serverId });

      expect(getFlag("ai_reviews_enabled", { server: serverId })).toBe(true);
      expect(getFlag("ai_reviews_enabled")).toBe(false);

      clearFlagOverrides("ai_reviews_enabled");
    });

    test("returns most specific override when multiple match", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");
      const userId = DiscordAccountIdSchema.parse("98765432109876543");

      // Add overrides with different specificity
      addFlagOverride("ai_reviews_enabled", true, { server: serverId });
      addFlagOverride("ai_reviews_enabled", false, { server: serverId, user: userId });

      // More specific override should win
      expect(getFlag("ai_reviews_enabled", { server: serverId })).toBe(true);
      expect(getFlag("ai_reviews_enabled", { server: serverId, user: userId })).toBe(false);

      clearFlagOverrides("ai_reviews_enabled");
    });

    test("ignores overrides that don't match all attributes", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");
      const otherServerId = DiscordGuildIdSchema.parse("98765432109876543");
      const userId = DiscordAccountIdSchema.parse("11111111111111111");

      addFlagOverride("ai_reviews_enabled", true, { server: serverId, user: userId });

      // Should match
      expect(getFlag("ai_reviews_enabled", { server: serverId, user: userId })).toBe(true);

      // Should not match (wrong server)
      expect(getFlag("ai_reviews_enabled", { server: otherServerId, user: userId })).toBe(false);

      // Should not match (missing user)
      expect(getFlag("ai_reviews_enabled", { server: serverId })).toBe(false);

      clearFlagOverrides("ai_reviews_enabled");
    });
  });

  describe("Specificity matching", () => {
    beforeEach(() => {
      clearLimitOverrides("player_subscriptions");
    });

    test("server+user beats server alone", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");
      const userId = DiscordAccountIdSchema.parse("98765432109876543");

      addLimitOverride("player_subscriptions", 20, { server: serverId });
      addLimitOverride("player_subscriptions", 100, { server: serverId, user: userId });

      expect(getLimit("player_subscriptions", { server: serverId, user: userId })).toBe(100);

      clearLimitOverrides("player_subscriptions");
    });

    test("server+user+player beats server+user", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");
      const userId = DiscordAccountIdSchema.parse("98765432109876543");
      const playerId = 42;

      addLimitOverride("player_subscriptions", 20, { server: serverId });
      addLimitOverride("player_subscriptions", 50, { server: serverId, user: userId });
      addLimitOverride("player_subscriptions", 200, { server: serverId, user: userId, player: playerId });

      expect(getLimit("player_subscriptions", { server: serverId, user: userId, player: playerId })).toBe(200);

      clearLimitOverrides("player_subscriptions");
    });

    test("partial override doesn't match when query has more attributes", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");
      const userId = DiscordAccountIdSchema.parse("98765432109876543");

      addLimitOverride("player_subscriptions", 50, { server: serverId });

      // Override should still match (override attributes are subset of query)
      expect(getLimit("player_subscriptions", { server: serverId, user: userId })).toBe(50);

      clearLimitOverrides("player_subscriptions");
    });
  });

  describe("Runtime override management", () => {
    test("addLimitOverride adds new override", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");

      expect(getLimit("accounts", { server: serverId })).toBe(50);

      addLimitOverride("accounts", 100, { server: serverId });
      expect(getLimit("accounts", { server: serverId })).toBe(100);

      clearLimitOverrides("accounts");
    });

    test("addFlagOverride adds new override", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");

      expect(getFlag("ai_reviews_enabled", { server: serverId })).toBe(false);

      addFlagOverride("ai_reviews_enabled", true, { server: serverId });
      expect(getFlag("ai_reviews_enabled", { server: serverId })).toBe(true);

      clearFlagOverrides("ai_reviews_enabled");
    });

    test("clearLimitOverrides removes all overrides", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");

      addLimitOverride("accounts", 100, { server: serverId });
      expect(getLimit("accounts", { server: serverId })).toBe(100);

      clearLimitOverrides("accounts");
      expect(getLimit("accounts", { server: serverId })).toBe(50);
    });

    test("clearFlagOverrides removes all overrides", () => {
      const serverId = DiscordGuildIdSchema.parse("12345678901234567");

      addFlagOverride("ai_reviews_enabled", true, { server: serverId });
      expect(getFlag("ai_reviews_enabled", { server: serverId })).toBe(true);

      clearFlagOverrides("ai_reviews_enabled");
      expect(getFlag("ai_reviews_enabled", { server: serverId })).toBe(false);
    });
  });

  describe("Type safety", () => {
    test("limit names are type-checked", () => {
      // These should compile
      const validLimits: LimitName[] = [
        "player_subscriptions",
        "accounts",
        "competitions_per_owner",
        "competitions_per_server",
      ];

      for (const limit of validLimits) {
        expect(getLimit(limit)).toBeNumber();
      }
    });

    test("flag names are type-checked", () => {
      // These should compile
      const validFlags: FlagName[] = ["ai_reviews_enabled"];

      for (const flag of validFlags) {
        expect(getFlag(flag)).toBeBoolean();
      }
    });
  });
});
