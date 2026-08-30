import { expect, test } from "vitest";
import { buildDevDiscordLaunch } from "./dev-discord.ts";

const environment = {
  DISCORD_BOT_TOKEN: "derrej-bot-token",
  SCOUT_DISCORD_SMOKE_GUILD_ID: "100000000000000001",
  RIOT_API_KEY: "riot-token",
};

test("builds a stable Discord-only development runtime", () => {
  expect(
    buildDevDiscordLaunch(
      [
        "--scenario",
        "gateway",
        "--database-url",
        "postgres://scout@127.0.0.1:5471/scout_test_smoke",
      ],
      environment,
    ),
  ).toEqual({
    args: [
      "bun",
      "scripts/dev-web.ts",
      "--no-background-jobs",
      "--no-web",
      "--no-backend-watch",
      "--database-url",
      "postgres://scout@127.0.0.1:5471/scout_test_smoke",
    ],
    environment: {
      ...environment,
      APPLICATION_ID: "1542993271477899294",
      DISCORD_TOKEN: "derrej-bot-token",
      ENVIRONMENT: "dev",
      FEATURE_FLAGS_MODE: "static",
      FEATURE_FLAGS_STATIC_OVERRIDES: "{}",
      SCOUT_DEV_BACKEND_ENTRYPOINT: "src/dev-discord.ts",
      SCOUT_DEV_CONSUMER_PREVIEW: "false",
      SCOUT_DISCORD_SMOKE_SCENARIO: "gateway",
    },
  });
});

test("refuses missing credentials, guilds, and unknown scenarios", () => {
  expect(() => buildDevDiscordLaunch(["--scenario", "gateway"], {})).toThrow(
    "DISCORD_BOT_TOKEN",
  );
  expect(() =>
    buildDevDiscordLaunch(["--scenario", "gateway"], {
      DISCORD_BOT_TOKEN: "token",
    }),
  ).toThrow("SCOUT_DISCORD_SMOKE_GUILD_ID");
  expect(() =>
    buildDevDiscordLaunch(["--scenario", "unknown"], environment),
  ).toThrow();
});

test("leaves provider overrides empty so guild-scoped registry flags decide", () => {
  const launch = buildDevDiscordLaunch(
    ["--scenario", "bb-transfer"],
    environment,
  );
  expect(launch.environment["FEATURE_FLAGS_STATIC_OVERRIDES"]).toBe("{}");
});
