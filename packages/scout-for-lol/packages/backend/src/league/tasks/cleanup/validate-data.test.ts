import { describe, expect, test } from "vitest";
import {
  resolveOrphanedChannelIds,
  resolveOrphanedGuildIds,
} from "#src/league/tasks/cleanup/validate-data.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";

/**
 * The guild half of the hourly data-validation job decides what gets DELETED —
 * subscriptions, server permissions and permission-error records. These tests
 * pin the one property that matters: a guild is only ever orphaned when Discord
 * or the install table positively says Scout is gone.
 *
 * The bug these replace: the answer came from `client.guilds.cache`, which is
 * permanently empty on any process that owns no gateway. On the split-capable
 * `activity-worker` role that would have classified EVERY guild with a
 * subscription as orphaned on the first hourly run and deleted all of it. There
 * is deliberately no `client` in this path any more, so an empty cache is
 * structurally incapable of influencing the outcome.
 */

const installedGuild = testGuildId("630000000000000001");
const removedGuild = testGuildId("630000000000000002");
const rowlessButPresentGuild = testGuildId("630000000000000003");

describe("orphaned guild resolution", () => {
  test("a guild with a live install row is never orphaned", async () => {
    let restCalls = 0;
    const orphaned = await resolveOrphanedGuildIds([installedGuild], {
      installedAmong: () => Promise.resolve(new Set([installedGuild])),
      isInstalled: () => {
        restCalls += 1;
        return Promise.resolve(false);
      },
    });

    expect(orphaned).toEqual([]);
    // The table already proved presence, so Discord is not asked at all — that
    // is what keeps this one query rather than one REST call per guild.
    expect(restCalls).toBe(0);
  });

  test("a guild Discord confirms Scout has left is orphaned", async () => {
    const orphaned = await resolveOrphanedGuildIds([removedGuild], {
      installedAmong: () => Promise.resolve(new Set()),
      isInstalled: () => Promise.resolve(false),
    });

    expect(orphaned).toEqual([removedGuild]);
  });

  test("a missing install row alone does not orphan a guild", async () => {
    // `GuildInstall` did not exist for Scout's earliest guilds and its writer
    // swallows failures, so a missing row is not proof of absence. Discord is
    // asked, and it says Scout is still there.
    const orphaned = await resolveOrphanedGuildIds([rowlessButPresentGuild], {
      installedAmong: () => Promise.resolve(new Set()),
      isInstalled: () => Promise.resolve(true),
    });

    expect(orphaned).toEqual([]);
  });

  test("an unreachable Discord aborts instead of orphaning anything", async () => {
    // "Scout could not ask" must never become "Scout was removed" when the
    // answer is wired to deleteMany. The throw propagates out of the activity,
    // which Temporal retries; nothing is deleted this cycle.
    await expect(
      resolveOrphanedGuildIds([removedGuild], {
        installedAmong: () => Promise.resolve(new Set()),
        isInstalled: () =>
          Promise.reject(
            new DiscordUpstreamError("fetch_error", "Discord unreachable"),
          ),
      }),
    ).rejects.toBeInstanceOf(DiscordUpstreamError);
  });

  test("one unreachable guild does not let the others be deleted", async () => {
    const attempted: string[] = [];
    await expect(
      resolveOrphanedGuildIds([removedGuild, rowlessButPresentGuild], {
        installedAmong: () => Promise.resolve(new Set()),
        isInstalled: (guildId) => {
          attempted.push(guildId);
          return Promise.reject(
            new DiscordUpstreamError("http_error", "Discord unreachable", 503),
          );
        },
      }),
    ).rejects.toBeInstanceOf(DiscordUpstreamError);

    // Aborts on the first failure rather than accumulating a partial orphan
    // list from whichever guilds happened to answer.
    expect(attempted).toEqual([removedGuild]);
  });

  test("nothing stored means nothing deleted", async () => {
    const orphaned = await resolveOrphanedGuildIds([], {
      installedAmong: () => Promise.resolve(new Set()),
      isInstalled: () => Promise.resolve(false),
    });

    expect(orphaned).toEqual([]);
  });
});

describe("orphaned channel resolution", () => {
  /**
   * The channel half deletes subscriptions, and it had the same shape of bug as
   * the guild half for a different reason: `client.channels.fetch` performs the
   * REST read and then resolves `null` when it cannot attach the result to a
   * CACHED GUILD. On a process with no gateway the guild cache is empty, so
   * every subscribed channel came back `null` — "no longer exists" — and every
   * subscription would have been deleted on the first hourly run. The reader is
   * now the cache-independent bot REST port.
   */

  const liveChannel = testChannelId("640000000000000001");
  const deletedChannel = testChannelId("640000000000000002");

  test("a channel Discord still returns is never orphaned", async () => {
    const orphaned = await resolveOrphanedChannelIds([liveChannel], {
      readChannel: () =>
        Promise.resolve({
          id: liveChannel,
          name: "general",
          type: 0,
          permission_overwrites: [],
        }),
    });

    expect(orphaned).toEqual([]);
  });

  test("a confirmed Unknown Channel is orphaned", async () => {
    const orphaned = await resolveOrphanedChannelIds([deletedChannel], {
      readChannel: () => Promise.resolve(null),
    });

    expect(orphaned).toEqual([deletedChannel]);
  });

  test("an unreachable Discord orphans nothing", async () => {
    // A rate limit, a 5xx or a timeout is "Scout could not ask". The old
    // `.catch(() => null)` turned all three into "deleted".
    const orphaned = await resolveOrphanedChannelIds(
      [liveChannel, deletedChannel],
      {
        readChannel: () =>
          Promise.reject(
            new DiscordUpstreamError("http_error", "rate limited", 429),
          ),
      },
    );

    expect(orphaned).toEqual([]);
  });

  test("one unreachable channel does not stop the others being checked", async () => {
    // Unlike the guild half this does NOT abort: each channel is an
    // independent subscription, and a single flaky read should not postpone
    // cleanup of a channel Discord positively confirmed is gone.
    const orphaned = await resolveOrphanedChannelIds(
      [liveChannel, deletedChannel],
      {
        readChannel: (channelId) =>
          channelId === liveChannel
            ? Promise.reject(
                new DiscordUpstreamError("fetch_error", "unreachable"),
              )
            : Promise.resolve(null),
      },
    );

    expect(orphaned).toEqual([deletedChannel]);
  });
});
