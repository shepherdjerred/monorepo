import { afterEach, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { BootstrapSchema, mediaBehaviorConfig } from "./config.ts";

afterEach(async () => {
  await shutdownFeatureFlags();
});

test.each([true, false])(
  "personal Discord uses the resolved %s flag value",
  async (value) => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        "media-personal-discord-enabled": value,
      }),
    });
    await expect(
      mediaBehaviorConfig("production").get("personalDiscordEnabled"),
    ).resolves.toEqual({ value, source: "flag" });
  },
);

test.each(["", "wrong", "-1", "1,2"])(
  "invalid shared Discord channel %s fails closed",
  async (value) => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        "media-shared-discord-channel-id": value,
      }),
    });
    await expect(
      mediaBehaviorConfig("production").get("sharedDiscordChannelId"),
    ).rejects.toThrow();
  },
);

test("defaults enable requests and acquisition while destructive and optional gates stay closed", async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  const config = mediaBehaviorConfig("production");
  for (const key of [
    "sourceCleanupEnabled",
    "quarantineEnabled",
    "purgeEnabled",
    "sharedAnnouncementsEnabled",
    "personalDiscordEnabled",
    "sharedAnnouncementsUpgrades",
  ] as const) {
    expect(await config.get(key)).toMatchObject({ value: false });
  }
  for (const key of ["requestsEnabled", "acquisitionEnabled"] as const) {
    expect(await config.get(key)).toMatchObject({ value: true });
  }
  expect(await config.get("keepDays")).toMatchObject({ value: 30 });
  expect(await config.get("sharedDiscordChannelId")).toMatchObject({
    value: "",
  });
  expect(await config.get("permittedMovieSectionId")).toMatchObject({
    value: "1",
  });
  expect(await config.get("permittedTvSectionId")).toMatchObject({
    value: "2",
  });
});

test.each(["0", "-1", "all", "1,2"])(
  "invalid permitted section %s fails closed",
  async (value) => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        "media-permitted-movie-section-id": value,
      }),
    });
    await expect(
      mediaBehaviorConfig("production").get("permittedMovieSectionId"),
    ).rejects.toThrow();
  },
);

test("a resolved false stays authoritative independently of another enabled gate", async () => {
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({
      "media-acquisition-enabled": true,
      "media-purge-enabled": false,
    }),
  });
  const config = mediaBehaviorConfig("beta");
  expect(await config.get("acquisitionEnabled")).toMatchObject({ value: true });
  expect(await config.get("purgeEnabled")).toMatchObject({ value: false });
});

test.each([
  ["media-keep-days", "keepDays", "0"],
  ["media-keep-days", "keepDays", "-1"],
  ["media-keep-days", "keepDays", "366"],
  ["media-keep-days", "keepDays", "not-a-number"],
  ["media-artwork-cache-max-bytes", "artworkCacheMaxBytes", "0"],
  ["media-artwork-cache-max-bytes", "artworkCacheMaxBytes", "1048576"],
  ["media-artwork-cache-max-bytes", "artworkCacheMaxBytes", "1.5"],
  ["media-artwork-cache-max-bytes", "artworkCacheMaxBytes", "unlimited"],
] as const)(
  "present invalid %s (%s) value %s fails instead of falling back",
  async (flag, key, value) => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ [flag]: value }),
    });
    await expect(mediaBehaviorConfig("production").get(key)).rejects.toThrow();
  },
);

test("the artwork cache cap defaults to 3 GiB and takes a managed value", async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  await expect(
    mediaBehaviorConfig("production").get("artworkCacheMaxBytes"),
  ).resolves.toEqual({ value: 3_221_225_472, source: "default" });
  await shutdownFeatureFlags();
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({
      "media-artwork-cache-max-bytes": "1073741824",
    }),
  });
  await expect(
    mediaBehaviorConfig("production").get("artworkCacheMaxBytes"),
  ).resolves.toEqual({ value: 1_073_741_824, source: "flag" });
});

test.each([undefined, "", "artwork", "./artwork"])(
  "bootstrap requires an absolute artwork cache directory, not %s",
  (directory) => {
    const environment = {
      DATABASE_URL: "postgresql://media@localhost/media",
      MEDIA_CREDENTIAL_KEY: "key",
      PLEX_SERVER_MACHINE_ID: "server",
      PLEX_SERVER_URL: "http://plex:32400",
      PLEX_OWNER_ACCOUNT_ID: "owner",
      TMDB_TOKEN: "token",
      PUBLIC_ORIGIN: "https://media.example.test",
      TEMPORAL_ADDRESS: "temporal:7233",
      TEMPORAL_NAMESPACE: "prod",
    };
    expect(
      BootstrapSchema.safeParse({
        ...environment,
        MEDIA_ARTWORK_CACHE_DIR: directory,
      }).success,
    ).toBe(false);
    expect(
      BootstrapSchema.parse({
        ...environment,
        MEDIA_ARTWORK_CACHE_DIR: "/var/cache/media/artwork",
      }).MEDIA_ARTWORK_CACHE_DIR,
    ).toBe("/var/cache/media/artwork");
  },
);

test("invalid boolean values fail instead of enabling effects", async () => {
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({ "media-purge-enabled": "true" }),
  });
  await expect(
    mediaBehaviorConfig("production").get("purgeEnabled"),
  ).rejects.toThrow();
});
