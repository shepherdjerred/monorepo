/**
 * Consumer access grants against a real `GuildInstall` table, because the whole
 * question is which rows may grant and which must be confirmed first.
 *
 * `installedGuildIdsAmong` on its own is picker semantics — it answers from the
 * table without asking Discord. That is right for *offering* a guild and wrong
 * for *granting* one: rows outlive a removal on purpose and `guildDelete`
 * swallows its own write failures, so a stale row would hand a caller access to
 * a server Scout has already left.
 */

import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { confirmedInstalledAmong } from "#src/consumer/access.ts";
import type { DiscordGuildId } from "@scout-for-lol/data";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import type { InstalledGuildsDependencies } from "#src/lib/discord/installed-guilds.ts";
import type { BotRestReader } from "#src/lib/discord/bot-rest.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("consumer-confirmed-access");

/** Scout is installed and Discord agrees. */
const LIVE = testGuildId("711");
/** A live row whose guild Scout has actually been removed from. */
const STALE = testGuildId("712");
/** The caller is in it; Scout never was. */
const UNRELATED = testGuildId("713");

function unused(): never {
  throw new Error("not used by consumer access");
}

function dependencies(
  guildExists: (guildId: string) => Promise<boolean>,
): InstalledGuildsDependencies {
  const reader: BotRestReader = {
    guildExists,
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
  };
  return { db: prisma, rest: reader, isDevOverrideGuild: () => false };
}

async function seedInstall(serverId: DiscordGuildId): Promise<void> {
  await prisma.guildInstall.create({
    data: {
      serverId,
      serverName: `guild-${serverId}`,
      ownerDiscordId: testAccountId("715"),
      addedByDiscordId: testAccountId("715"),
      memberCount: 10,
      installedAt: new Date(),
      removedAt: null,
    },
  });
}

beforeEach(async () => {
  await prisma.guildInstall.deleteMany();
});

afterAll(async () => {
  await prisma.guildInstall.deleteMany();
  await prisma.$disconnect();
});

describe("confirmed consumer access", () => {
  test("a live row confirmed by Discord grants", async () => {
    await seedInstall(LIVE);

    const granted = await confirmedInstalledAmong(
      [LIVE, UNRELATED],
      dependencies(() => Promise.resolve(true)),
    );

    expect([...granted]).toEqual([LIVE]);
  });

  test("a stale row that Discord contradicts does NOT grant", async () => {
    // The row says installed; Discord says Unknown Guild. This is the case the
    // unconfirmed picker lookup got wrong — it would have granted access to a
    // server Scout was removed from.
    await seedInstall(STALE);

    const granted = await confirmedInstalledAmong(
      [STALE],
      dependencies(() => Promise.resolve(false)),
    );

    expect([...granted]).toEqual([]);
  });

  test("an unreachable Discord still grants on a live row", async () => {
    // The install port's documented asymmetry: with a row to fall back on, an
    // outage trusts the row and warns rather than locking a real member out.
    await seedInstall(LIVE);

    const granted = await confirmedInstalledAmong(
      [LIVE],
      dependencies(() =>
        Promise.reject(new DiscordUpstreamError("fetch_error", "unreachable")),
      ),
    );

    expect([...granted]).toEqual([LIVE]);
  });

  test("a guild with no row is never asked about and never grants", async () => {
    const asked: string[] = [];

    const granted = await confirmedInstalledAmong(
      [UNRELATED],
      dependencies((guildId) => {
        asked.push(guildId);
        return Promise.resolve(true);
      }),
    );

    // The table narrows first, so a guild the caller shares with Scout only in
    // their own Discord account costs no REST read at all.
    expect([...granted]).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("every granted guild is confirmed, not just the first", async () => {
    // The returned list is also the Explore alias-resolution scope, so
    // short-circuiting after one confirmation would silently narrow which
    // servers a caller can resolve names in.
    const second = testGuildId("714");
    await seedInstall(LIVE);
    await seedInstall(second);
    const asked: string[] = [];

    const granted = await confirmedInstalledAmong(
      [LIVE, second],
      dependencies((guildId) => {
        asked.push(guildId);
        return Promise.resolve(true);
      }),
    );

    expect([...granted].toSorted()).toEqual([LIVE, second].toSorted());
    expect(asked.toSorted()).toEqual([LIVE, second].toSorted());
  });

  test("confirmations run together, not one after another", async () => {
    // Serially these were N cold reads each bounded by the REST client's
    // 5-second timeout, so a member in several Scout servers waited out the
    // sum of them before their first page rendered.
    const second = testGuildId("714");
    await seedInstall(LIVE);
    await seedInstall(second);
    let inFlight = 0;
    let peakInFlight = 0;
    const arrived = Promise.withResolvers<undefined>();

    const granted = await confirmedInstalledAmong(
      [LIVE, second],
      dependencies(async () => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        // Every read parks until both have arrived, which only completes if
        // they were started without waiting for each other.
        if (inFlight === 2) arrived.resolve(undefined);
        await arrived.promise;
        inFlight -= 1;
        return true;
      }),
    );

    expect(peakInFlight).toBe(2);
    expect([...granted].toSorted()).toEqual([LIVE, second].toSorted());
  });

  test("one broken guild is skipped, not fatal to the rest", async () => {
    // Every candidate has a live row, so the port already absorbs a Discord
    // outage by trusting the row. A throw is therefore something unexpected —
    // and a single rejection escaping here would make the caller's WHOLE
    // consumer surface `unavailable`, taking away every other server they have.
    const second = testGuildId("714");
    await seedInstall(LIVE);
    await seedInstall(second);

    const granted = await confirmedInstalledAmong(
      [LIVE, second],
      dependencies((guildId) =>
        guildId === second
          ? Promise.reject(new Error("something unexpected"))
          : Promise.resolve(true),
      ),
    );

    expect([...granted]).toEqual([LIVE]);
  });

  test("every candidate failing DOES propagate", async () => {
    // With nothing confirmed there is no partial truth to serve, so the
    // failure has to surface as `unavailable` rather than as an empty list —
    // an empty list is a denial telling a real member they have no servers.
    await seedInstall(LIVE);

    await expect(
      confirmedInstalledAmong(
        [LIVE],
        dependencies(() => Promise.reject(new Error("something unexpected"))),
      ),
    ).rejects.toThrow("something unexpected");
  });

  test("no candidates at all is an empty answer, not a failure", async () => {
    // Nothing failed here — the caller simply shares no Scout server. That is
    // a legitimate `forbidden`, and must not be dressed up as unavailable.
    await expect(
      confirmedInstalledAmong([UNRELATED], dependencies(unused)),
    ).resolves.toEqual([]);
  });
});
