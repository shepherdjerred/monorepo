import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { randomTip, TIPS } from "@shepherdjerred/streambot/discord/tips.ts";
import { playTip } from "@shepherdjerred/streambot/discord/web-link.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";

beforeAll(async () => {
  await initFeatureFlags({
    environment: {
      FEATURE_FLAGS_MODE: "static",
      FEATURE_FLAGS_STATIC_OVERRIDES: '{"streambot-web-ui-enabled":true}',
    },
  });
});
afterAll(async () => {
  await shutdownFeatureFlags();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("tips", () => {
  test("has a non-trivial pool of tips", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(10);
    for (const tip of TIPS) {
      expect(tip.length).toBeGreaterThan(0);
    }
  });

  test("randomTip always returns a tip from the pool", () => {
    for (let i = 0; i < 50; i++) {
      expect(TIPS).toContain(randomTip());
    }
  });

  test.each([false, true])(
    "web tips retain fixed channels and follow automatic routing (%s)",
    async (automatic) => {
      const config = loadConfig({
        BOT_TOKEN: "fixture",
        USER_TOKENS: "fixture",
        VIDEOS_DIR: "/videos",
        WEB_PUBLIC_ORIGIN: "http://127.0.0.1:5188",
        DISCORD_CLIENT_SECRET: "fixture-only",
      });
      vi.spyOn(Math, "random").mockReturnValue(0.9999);
      const tip = await playTip(
        {
          config,
          guildId: "100000000000000001",
          playbackChannel: 1,
          ...(automatic
            ? {
                routePlayback: async () => {
                  throw new Error("Tip must not route playback");
                },
              }
            : {}),
        },
        "100000000000000099",
      );
      const url = new URL(tip.slice(tip.indexOf("http:")));
      expect(url.pathname).toBe("/plex");
      expect(url.searchParams.get("guild")).toBe("100000000000000001");
      expect(url.searchParams.get("channel")).toBe(automatic ? null : "1");
    },
  );
});
