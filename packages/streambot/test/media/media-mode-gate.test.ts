import { describe, expect, test } from "vitest";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const USER = UserIdSchema.parse("100000000000000001");
const GUILD = GuildIdSchema.parse("100000000000000010");
const CHANNEL = ChannelIdSchema.parse("100000000000000020");

const VIEW: PlaybackView = {
  state: "streaming",
  current: null,
  queue: [],
  loop: "off",
  volume: 100,
  positionSeconds: null,
};

/**
 * A service wired with a scope, so the music-over-voice gate is actually reachable. The default
 * harness in `playback-command-service.test.ts` deliberately has no `guildId`/`channelId`, which
 * makes `scope()` null and short-circuits every flag lookup — useful there, useless here.
 */
function createGatedService(options: {
  readonly musicOverVoice: boolean;
  readonly scoped?: boolean;
}) {
  const events: PlaybackEvent[] = [];
  const lookups: string[] = [];
  const featureGate: MediaFeatureGate = {
    assistantV2: () => Promise.resolve(true),
    history: () => Promise.resolve(false),
    musicOverVoice: () => {
      lookups.push("musicOverVoice");
      return Promise.resolve(options.musicOverVoice);
    },
  };
  const service = new PlaybackCommandService({
    config: loadConfig({
      BOT_TOKEN: "bot",
      USER_TOKENS: "userbot",
      VIDEOS_DIR: "/videos",
    }),
    dispatch: (event) => events.push(event),
    view: () => VIEW,
    library: () => [],
    setVolume: () => Promise.resolve(true),
    seek: () => Promise.resolve(true),
    resolvePlaySource: () =>
      Promise.resolve({
        title: "result",
        ffmpegInput: "https://media.invalid/a",
        mediaKind: "music" as const,
        chapters: [],
      }),
    announce: () => Promise.resolve(),
    featureGate,
    ...(options.scoped === false ? {} : { guildId: GUILD, channelId: CHANNEL }),
  });
  return { service, events, lookups };
}

describe("music-over-voice rollout gate", () => {
  test("forces video for every request while the flag is off", async () => {
    const { service } = createGatedService({ musicOverVoice: false });
    expect(await service.resolveMediaMode(USER, undefined)).toBe("video");
    expect(await service.resolveMediaMode(USER, "auto")).toBe("video");
    // Even an explicit "music" is overridden: the flag is the rollout switch, and a user opting in
    // per-request must not be able to route around a guild it has not been enabled for.
    expect(await service.resolveMediaMode(USER, "music")).toBe("video");
  });

  test("lets the classifier decide while the flag is on", async () => {
    const { service } = createGatedService({ musicOverVoice: true });
    // `undefined` and `"auto"` both mean "no explicit choice" and must stay unstamped, so nothing
    // redundant is written into the persisted source or the history row.
    expect(await service.resolveMediaMode(USER, undefined)).toBeUndefined();
    expect(await service.resolveMediaMode(USER, "auto")).toBeUndefined();
    expect(await service.resolveMediaMode(USER, "music")).toBe("music");
  });

  test("an explicit video request needs no flag lookup", async () => {
    const { service, lookups } = createGatedService({ musicOverVoice: true });
    expect(await service.resolveMediaMode(USER, "video")).toBe("video");
    // It asks for exactly the behaviour the disabled flag falls back to, so consulting Flipt would
    // be a network round trip that cannot change the answer.
    expect(lookups).toEqual([]);
  });

  test("the gate fires on exactly this flag and nothing else", async () => {
    const { service, lookups } = createGatedService({ musicOverVoice: false });
    await service.resolveMediaMode(USER, "music");
    expect(lookups).toEqual(["musicOverVoice"]);
    // A gate that also disabled assistantV2 or history would leave every test here green while
    // silently breaking two unrelated features.
    expect(await service.isAssistantV2Enabled(USER)).toBe(true);
  });

  test("play() stamps the resolved mode onto the dispatched source", async () => {
    const { service, events } = createGatedService({ musicOverVoice: true });
    await service.play({
      query: "a song",
      source: "auto",
      placement: "queue",
      userId: USER,
      mode: "music",
    });
    // Covers the WIRING, not just `resolveMediaMode`. Without this, the call site could stop
    // stamping the mode entirely and every gate test above would still pass — the exact shape of
    // gap that showed up three times elsewhere in this change.
    const added = events.find((event) => event.type === "ADD");
    expect(added?.source.mode).toBe("music");
  });

  test("play() honours the rollout flag on the dispatched source", async () => {
    const { service, events } = createGatedService({ musicOverVoice: false });
    await service.play({
      query: "a song",
      source: "auto",
      placement: "queue",
      userId: USER,
      mode: "music",
    });
    const added = events.find((event) => event.type === "ADD");
    expect(added?.source.mode).toBe("video");
  });

  test('a spoken "watch" outranks the untouched auto default', async () => {
    const { service, events } = createGatedService({ musicOverVoice: true });
    await service.play({
      query: "watch the trailer",
      source: "auto",
      placement: "queue",
      userId: USER,
      mode: "auto",
    });
    // "auto" is the slash command's default rather than a choice anyone made, so it must defer to
    // the verb instead of suppressing it.
    const added = events.find((event) => event.type === "ADD");
    expect(added?.source.mode).toBe("video");
  });

  test("an explicit mode outranks the spoken verb", async () => {
    const { service, events } = createGatedService({ musicOverVoice: true });
    await service.play({
      query: "watch the trailer",
      source: "auto",
      placement: "queue",
      userId: USER,
      mode: "music",
    });
    const added = events.find((event) => event.type === "ADD");
    expect(added?.source.mode).toBe("music");
  });

  test("an unscoped session cannot evaluate the flag and passes the request through", async () => {
    const { service, lookups } = createGatedService({
      musicOverVoice: false,
      scoped: false,
    });
    // No guild/channel means no `DiscoveryScope`, so there is nothing to target a rollout at. The
    // request survives unchanged rather than being forced to video by a flag we could not read.
    expect(await service.resolveMediaMode(USER, "music")).toBe("music");
    expect(lookups).toEqual([]);
  });
});
