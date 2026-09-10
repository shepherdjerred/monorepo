/**
 * The installation port's contract, exercised against a real `GuildInstall`
 * table because the whole point of the module is which *rows* count.
 */

import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { DiscordGuildId } from "@scout-for-lol/data";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import {
  installedGuildIdsAmong,
  installedGuildName,
  isScoutInstalledInGuild,
  type InstalledGuildsDependencies,
} from "#src/lib/discord/installed-guilds.ts";
import type { BotRestReader } from "#src/lib/discord/bot-rest.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("installed-guilds-port");

const INSTALLED = testGuildId("701");
const REMOVED = testGuildId("702");
const ABSENT = testGuildId("703");
const DEV_ONLY = testGuildId("704");

type RestStub = {
  reader: BotRestReader;
  calls: string[];
};

function unused(): never {
  throw new Error("not used by the installation port");
}

function restStub(
  guildExists: (guildId: string) => Promise<boolean>,
): RestStub {
  const calls: string[] = [];
  return {
    calls,
    reader: {
      guildExists: async (guildId) => {
        calls.push(guildId);
        return await guildExists(guildId);
      },
      guild: unused,
      guildChannels: unused,
      guildRoles: unused,
      botMember: unused,
      guildMember: unused,
      freshGuildMember: unused,
      searchGuildMembers: unused,
      user: unused,
      channel: unused,
      clearCaches: () => {
        /* no cache in the stub */
      },
    },
  };
}

function dependencies(
  rest: BotRestReader,
  devGuildIds: readonly string[] = [],
): InstalledGuildsDependencies {
  return {
    db: prisma,
    rest,
    isDevOverrideGuild: (guildId) => devGuildIds.includes(guildId),
  };
}

async function seed(
  serverId: DiscordGuildId,
  removedAt: Date | null,
): Promise<void> {
  await prisma.guildInstall.create({
    data: {
      serverId,
      serverName: `Server ${serverId}`,
      ownerDiscordId: testAccountId("81"),
      addedByDiscordId: testAccountId("81"),
      memberCount: 3,
      installedAt: new Date("2026-01-01T00:00:00.000Z"),
      removedAt,
    },
  });
}

describe("isScoutInstalledInGuild", () => {
  beforeEach(async () => {
    await prisma.guildInstall.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("a live row confirmed by Discord is installed", async () => {
    await seed(INSTALLED, null);
    const rest = restStub(() => Promise.resolve(true));
    await expect(
      isScoutInstalledInGuild(INSTALLED, dependencies(rest.reader)),
    ).resolves.toBe(true);
    // The row is not taken on trust: a removal while the gateway was down
    // fires no guildDelete, so the positive is confirmed too.
    expect(rest.calls).toEqual([INSTALLED]);
  });

  test("a live row is overruled when Discord says Scout was removed", async () => {
    await seed(INSTALLED, null);
    const rest = restStub(() => Promise.resolve(false));
    await expect(
      isScoutInstalledInGuild(INSTALLED, dependencies(rest.reader)),
    ).resolves.toBe(false);
    expect(rest.calls).toEqual([INSTALLED]);
  });

  test("a live row is TRUSTED when Discord cannot be reached", async () => {
    // The asymmetry: with a row to fall back on, availability wins. 503ing a
    // working dashboard over a Discord blip is worse than the staleness this
    // system already had before the row was consulted.
    await seed(INSTALLED, null);
    const rest = restStub(() =>
      Promise.reject(new DiscordUpstreamError("fetch_error", "blip")),
    );
    await expect(
      isScoutInstalledInGuild(INSTALLED, dependencies(rest.reader)),
    ).resolves.toBe(true);
  });

  test("a removed row is not treated as installed", async () => {
    await seed(REMOVED, new Date("2026-02-01T00:00:00.000Z"));
    const rest = restStub(() => Promise.resolve(false));
    await expect(
      isScoutInstalledInGuild(REMOVED, dependencies(rest.reader)),
    ).resolves.toBe(false);
    // Row existence is not the signal, so the negative had to be confirmed.
    expect(rest.calls).toEqual([REMOVED]);
  });

  test("a re-installed row (removedAt cleared) is installed again", async () => {
    await seed(REMOVED, new Date("2026-02-01T00:00:00.000Z"));
    await prisma.guildInstall.update({
      where: { serverId: REMOVED },
      data: { removedAt: null },
    });
    const rest = restStub(() => Promise.resolve(true));
    await expect(
      isScoutInstalledInGuild(REMOVED, dependencies(rest.reader)),
    ).resolves.toBe(true);
  });

  test("a missing row is confirmed against Discord, not assumed absent", async () => {
    const rest = restStub(() => Promise.resolve(true));
    await expect(
      isScoutInstalledInGuild(ABSENT, dependencies(rest.reader)),
    ).resolves.toBe(true);
    expect(rest.calls).toEqual([ABSENT]);
  });

  test("Discord confirming absence answers no", async () => {
    const rest = restStub(() => Promise.resolve(false));
    await expect(
      isScoutInstalledInGuild(ABSENT, dependencies(rest.reader)),
    ).resolves.toBe(false);
  });

  test("with NO row, an unreachable Discord propagates rather than denying", async () => {
    // The other half of the asymmetry: nothing to fall back on, so the outage
    // has to surface as an outage instead of "Scout is not installed".
    const rest = restStub(() =>
      Promise.reject(new DiscordUpstreamError("http_error", "boom", 503)),
    );
    await expect(
      isScoutInstalledInGuild(ABSENT, dependencies(rest.reader)),
    ).rejects.toBeInstanceOf(DiscordUpstreamError);
  });

  test("with a REMOVED row, an unreachable Discord also propagates", async () => {
    await seed(REMOVED, new Date("2026-02-01T00:00:00.000Z"));
    const rest = restStub(() =>
      Promise.reject(new DiscordUpstreamError("http_error", "boom", 503)),
    );
    await expect(
      isScoutInstalledInGuild(REMOVED, dependencies(rest.reader)),
    ).rejects.toBeInstanceOf(DiscordUpstreamError);
  });

  test("a dev-override guild is installed with no row and no Discord call", async () => {
    const rest = restStub(() => Promise.resolve(false));
    await expect(
      isScoutInstalledInGuild(DEV_ONLY, dependencies(rest.reader, [DEV_ONLY])),
    ).resolves.toBe(true);
    expect(rest.calls).toEqual([]);
  });
});

describe("installedGuildIdsAmong", () => {
  beforeEach(async () => {
    await prisma.guildInstall.deleteMany();
  });

  test("returns only live rows and never fans out to Discord", async () => {
    await seed(INSTALLED, null);
    await seed(REMOVED, new Date("2026-02-01T00:00:00.000Z"));
    const rest = restStub(() => Promise.resolve(true));
    const installed = await installedGuildIdsAmong(
      [INSTALLED, REMOVED, ABSENT],
      dependencies(rest.reader),
    );
    expect([...installed]).toEqual([INSTALLED]);
    expect(rest.calls).toEqual([]);
  });

  test("includes dev-override guilds", async () => {
    const rest = restStub(() => Promise.resolve(false));
    const installed = await installedGuildIdsAmong(
      [DEV_ONLY],
      dependencies(rest.reader, [DEV_ONLY]),
    );
    expect([...installed]).toEqual([DEV_ONLY]);
  });
});

describe("installedGuildName", () => {
  beforeEach(async () => {
    await prisma.guildInstall.deleteMany();
  });

  test("returns the recorded name, or null when there is no row", async () => {
    await seed(INSTALLED, null);
    const rest = restStub(() => Promise.resolve(false));
    await expect(
      installedGuildName(INSTALLED, dependencies(rest.reader)),
    ).resolves.toBe(`Server ${INSTALLED}`);
    await expect(
      installedGuildName(ABSENT, dependencies(rest.reader)),
    ).resolves.toBeNull();
  });
});
