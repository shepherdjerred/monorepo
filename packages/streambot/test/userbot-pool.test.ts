import { describe, expect, test } from "bun:test";
import {
  UserbotPool,
  type PooledStreamer,
  type StreamerFactory,
} from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  GuildIdSchema,
  UserTokenSchema,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";

const STREAM_CONFIG: Pick<Config, "stream"> = {
  stream: {
    width: 1280,
    height: 720,
    fps: 30,
    bitrateKbps: 2000,
    bitrateAudioKbps: 128,
    hardwareAcceleration: false,
    vaapiDevice: "/dev/dri/renderD128",
  },
};

const GUILD_A = GuildIdSchema.parse("100000000000000001");
const GUILD_B = GuildIdSchema.parse("100000000000000002");
const GUILD_C = GuildIdSchema.parse("100000000000000003");

/** A fake pooled streamer that records destroy and reports a fixed guild membership. */
function fakeStreamer(guilds: GuildId[], onLogin?: () => Promise<void>) {
  let destroyed = false;
  const streamer: PooledStreamer = {
    login: () => onLogin?.() ?? Promise.resolve(),
    guildIds: () => guilds,
    joinVoice: (input) =>
      Promise.resolve({ guildId: input.guildId, channelId: input.channelId }),
    runStream: () => Promise.resolve(),
    leaveVoice: () => Promise.resolve(),
    setVolume: () => Promise.resolve(true),
    seek: () => Promise.resolve(true),
    getPosition: () => null,
    userId: () => "200000000000000000",
    destroy: () => {
      destroyed = true;
      return Promise.resolve();
    },
  };
  return { streamer, isDestroyed: () => destroyed };
}

function tokens(n: number) {
  return Array.from({ length: n }, (_unused, index) =>
    UserTokenSchema.parse(`token-${String(index)}`),
  );
}

/** Every userbot fails to log in (used for the all-fail path). */
const allFailFactory: StreamerFactory = () =>
  fakeStreamer([GUILD_A], () =>
    Promise.reject(new Error("an invalid token was provided")),
  ).streamer;

describe("UserbotPool", () => {
  test("acquire returns a member-userbot and marks it busy; release frees it", async () => {
    const factory: StreamerFactory = () => fakeStreamer([GUILD_A]).streamer;
    const pool = new UserbotPool(tokens(1), STREAM_CONFIG, factory);
    await pool.start();

    const first = pool.acquire(GUILD_A);
    expect(first).not.toBeNull();
    // Pool is now empty — a second acquire for the same guild fails.
    expect(pool.acquire(GUILD_A)).toBeNull();

    if (first !== null) {
      pool.release(first);
    }
    expect(pool.acquire(GUILD_A)).not.toBeNull();
  });

  test("acquire only matches userbots that are members of the guild", async () => {
    const memberships = [[GUILD_A], [GUILD_B]];
    let call = 0;
    const factory: StreamerFactory = () => {
      const guilds = memberships[call] ?? [];
      call += 1;
      return fakeStreamer(guilds).streamer;
    };
    const pool = new UserbotPool(tokens(2), STREAM_CONFIG, factory);
    await pool.start();

    expect(pool.acquire(GUILD_C)).toBeNull(); // no userbot is in guild C
    expect(pool.acquire(GUILD_A)).not.toBeNull();
    expect(pool.acquire(GUILD_B)).not.toBeNull();
  });

  test("two channels in the same guild consume two distinct userbots", async () => {
    const factory: StreamerFactory = () => fakeStreamer([GUILD_A]).streamer;
    const pool = new UserbotPool(tokens(2), STREAM_CONFIG, factory);
    await pool.start();

    const a = pool.acquire(GUILD_A);
    const b = pool.acquire(GUILD_A);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    expect(pool.acquire(GUILD_A)).toBeNull(); // pool exhausted
  });

  test("a token that fails to log in is skipped; the pool still starts", async () => {
    let call = 0;
    const factory: StreamerFactory = () => {
      const fails = call === 0;
      call += 1;
      return fakeStreamer([GUILD_A], () =>
        fails ? Promise.reject(new Error("bad token")) : Promise.resolve(),
      ).streamer;
    };
    const pool = new UserbotPool(tokens(2), STREAM_CONFIG, factory);
    await pool.start();
    // One succeeded → exactly one acquire works.
    expect(pool.acquire(GUILD_A)).not.toBeNull();
    expect(pool.acquire(GUILD_A)).toBeNull();
  });

  test("start throws (surfacing the cause) when every userbot fails to log in", async () => {
    const pool = new UserbotPool(tokens(2), STREAM_CONFIG, allFailFactory);
    await expect(pool.start()).rejects.toThrow("an invalid token was provided");
  });

  test("serveableGuildIds unions all member guilds", async () => {
    const memberships = [
      [GUILD_A, GUILD_B],
      [GUILD_B, GUILD_C],
    ];
    let call = 0;
    const factory: StreamerFactory = () => {
      const guilds = memberships[call] ?? [];
      call += 1;
      return fakeStreamer(guilds).streamer;
    };
    const pool = new UserbotPool(tokens(2), STREAM_CONFIG, factory);
    await pool.start();
    expect([...pool.serveableGuildIds()].toSorted()).toEqual(
      [GUILD_A, GUILD_B, GUILD_C].toSorted(),
    );
  });
});
