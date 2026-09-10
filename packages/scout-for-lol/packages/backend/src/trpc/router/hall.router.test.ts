import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

const trpc = await createOfflineTrpcHarness("trpc-hall-test");
const { prisma: db } = trpc;

const guildId = DiscordGuildIdSchema.parse("100000000000000051");
const otherGuildId = DiscordGuildIdSchema.parse("100000000000000052");
const actor = DiscordAccountIdSchema.parse("300000000000000051");

function caller() {
  return trpc.authedCaller(actor);
}

describe("hall.router", () => {
  beforeEach(() => {
    resetFlagOverrides("hall_of_fame_enabled");
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
  });

  afterAll(async () => {
    resetFlagOverrides("hall_of_fame_enabled");
    await db.$disconnect();
  });

  describe("hall.status", () => {
    test("rejects an unauthenticated caller", async () => {
      await expect(trpc.anonCaller().hall.status()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    test("returns feature_disabled when no shared guilds have Hall of Fame enabled", async () => {
      const status = await caller().hall.status();
      expect(status).toEqual({
        state: "feature_disabled",
        guilds: [],
      });
    });

    test("returns available with only the enabled shared guilds", async () => {
      addFlagOverride("hall_of_fame_enabled", true, { server: guildId });

      const status = await caller().hall.status();
      expect(status).toEqual({
        state: "available",
        guilds: [
          {
            id: guildId,
            name: "test-guild",
            icon: null,
          },
        ],
      });
    });

    test("returns all enabled shared guilds for multi-guild players", async () => {
      addFlagOverride("hall_of_fame_enabled", true, { server: guildId });
      addFlagOverride("hall_of_fame_enabled", true, { server: otherGuildId });

      const status = await caller().hall.status();
      expect(status).toEqual({
        state: "available",
        guilds: [
          {
            id: guildId,
            name: "test-guild",
            icon: null,
          },
          {
            id: otherGuildId,
            name: "test-guild",
            icon: null,
          },
        ],
      });
    });

    test("returns no_shared_guild when member shares no guilds where Scout is installed", async () => {
      trpc.setMembership([]);
      const status = await caller().hall.status();
      expect(status).toEqual({
        state: "no_shared_guild",
        guilds: [],
      });
    });
  });

  describe("hall.get", () => {
    test("throws NOT_FOUND if Hall of Fame is disabled for the guild", async () => {
      await expect(caller().hall.get({ guildId })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Hall of Fame is unavailable",
      });
    });

    test("returns hall data when enabled for member", async () => {
      addFlagOverride("hall_of_fame_enabled", true, { server: guildId });
      const result = await caller().hall.get({ guildId });
      expect(result.settings.guildId).toBe(guildId);
      expect(result.catalog).toBeDefined();
      expect(result.entries).toEqual([]);
    });
  });
});
