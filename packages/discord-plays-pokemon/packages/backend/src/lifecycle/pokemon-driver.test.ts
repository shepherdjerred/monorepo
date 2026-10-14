import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client as BotClient } from "discord.js";
import { Client as SelfbotClient } from "discord.js-selfbot-v13";
import type { Session } from "@shepherdjerred/discord-stream-lifecycle/session/session.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client.ts";
import { Emulator, type EmulatorOptions } from "#src/emulator/emulator.ts";
import { testConfig } from "#src/__tests__/fixtures/test-config.ts";
import { PokemonGameDriver, type SessionStreamer } from "./pokemon-driver.ts";

const GUILD_A = "100000000000000001";
const GUILD_B = "100000000000000002";

type Events = string[];

class FakeEmulator extends Emulator {
  constructor(
    readonly fakeOptions: EmulatorOptions,
    private readonly events: Events,
    private readonly flush: () => Promise<void>,
  ) {
    super(fakeOptions);
  }

  override async init(): Promise<void> {
    this.events.push(`init ${this.fakeOptions.savePath ?? ""}`);
    await Promise.resolve();
  }

  override start(): void {
    this.events.push("start");
  }

  override async stopAndFlush(): Promise<void> {
    this.events.push("flush:begin");
    await this.flush();
    this.events.push("flush:end");
  }
}

function fakeStreamer(events: Events, loginError?: Error): SessionStreamer {
  return {
    login: async () => {
      events.push("streamer:login");
      if (loginError !== undefined) throw loginError;
      await Promise.resolve();
    },
    start: async () => {
      events.push("streamer:start");
      await Promise.resolve();
    },
    stop: async () => {
      events.push("streamer:stop");
      await Promise.resolve();
    },
    shutdown: async () => {
      events.push("streamer:stop", "streamer:destroy");
      await Promise.resolve();
    },
    destroy: () => {
      events.push("streamer:destroy");
    },
    pushFrame: () => {
      /* frames are not under test */
    },
    pushAudio: () => {
      /* audio is not under test */
    },
  };
}

function session(guildId: string, root: string): Session<SelfbotPooledUserbot> {
  const userbot: SelfbotPooledUserbot = {
    client: new SelfbotClient(),
    login: () => Promise.resolve(),
    userId: () => "userbot",
    guildIds: () => [guildId],
    destroy: () => Promise.resolve(),
  };
  return {
    guildId,
    voiceChannelId: "voice",
    textChannelId: "text",
    startedByUserId: "starter",
    startedAt: new Date(),
    userbotEntry: { userbot, guildIds: new Set([guildId]), busy: true },
    // Relative, as production passes it: the driver must resolve it.
    sessionDir: path.relative(process.cwd(), path.join(root, guildId)),
  };
}

describe("PokemonGameDriver persistence", () => {
  let root: string;
  let events: Events;
  let emulators: FakeEmulator[];
  let flush: () => Promise<void>;
  let loginError: Error | undefined;

  function driver(goalGuildIds: readonly string[] = []): PokemonGameDriver {
    const created = new PokemonGameDriver({
      config: testConfig(false),
      goalGuildIds: new Set(goalGuildIds),
      factories: {
        createEmulator: (options) => {
          const emulator = new FakeEmulator(options, events, () => flush());
          emulators.push(emulator);
          return emulator;
        },
        createStreamer: () => fakeStreamer(events, loginError),
      },
    });
    created.setBotClient(new BotClient({ intents: [] }));
    return created;
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pokemon-driver-"));
    events = [];
    emulators = [];
    flush = () => Promise.resolve();
    loginError = undefined;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("each guild's emulator saves to its own absolute flash path", async () => {
    const pokemon = driver();
    const a = session(GUILD_A, root);
    const b = session(GUILD_B, root);

    await pokemon.onSessionStart(a);
    await pokemon.onSessionStop(a, "userStop");
    await pokemon.onSessionStart(b);
    await pokemon.onSessionStop(b, "userStop");

    expect(emulators.map((e) => e.fakeOptions.savePath)).toEqual([
      path.join(root, GUILD_A, "pokeemerald.flash"),
      path.join(root, GUILD_B, "pokeemerald.flash"),
    ]);
  });

  test("stop waits for the final flush and reports a failed one", async () => {
    const pokemon = driver();
    const a = session(GUILD_A, root);
    await pokemon.onSessionStart(a);
    const gate = Promise.withResolvers<undefined>();
    flush = () => gate.promise;

    const stopping = pokemon.onSessionStop(a, "userStop");
    await Bun.sleep(10);
    expect(events.at(-1)).toBe("flush:begin");
    gate.resolve(undefined);
    await stopping;
    expect(events.at(-1)).toBe("flush:end");

    await pokemon.onSessionStart(a);
    flush = () => Promise.reject(new Error("disk full"));
    await expect(pokemon.onSessionStop(a, "userStop")).rejects.toThrow(
      "disk full",
    );
    expect(pokemon.getActiveRuntime()).toBeNull();
  });

  test("a failed start tears down what it booted and flushes", async () => {
    loginError = new Error("voice login failed");
    const pokemon = driver();

    await expect(
      pokemon.onSessionStart(session(GUILD_A, root)),
    ).rejects.toThrow("voice login failed");

    expect(events).toEqual([
      `init ${path.join(root, GUILD_A, "pokeemerald.flash")}`,
      "start",
      "streamer:login",
      "streamer:stop",
      "streamer:destroy",
      "flush:begin",
      "flush:end",
    ]);
    expect(pokemon.getActiveRuntime()).toBeNull();
  });

  test("goal mode is limited to allowlisted guilds", () => {
    const disabled = driver([GUILD_A]);
    expect(disabled.goalEnabledForGuild(GUILD_A)).toBe(false);

    const enabled = new PokemonGameDriver({
      config: testConfig(true),
      goalGuildIds: new Set([GUILD_A]),
    });
    expect(enabled.goalEnabledForGuild(GUILD_A)).toBe(true);
    expect(enabled.goalEnabledForGuild(GUILD_B)).toBe(false);
  });
});
