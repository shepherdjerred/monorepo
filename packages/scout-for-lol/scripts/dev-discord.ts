import {
  DiscordSmokeScenarioNameSchema,
  discordSmokeStaticOverrides,
} from "@scout-for-lol/backend/discord-smoke-scenarios.ts";
import { requireCliValue } from "./migration-core.ts";

const DERREJ_APPLICATION_ID = "1542993271477899294";

export type DevDiscordLaunch = {
  readonly args: string[];
  readonly environment: Record<string, string | undefined>;
};

export function buildDevDiscordLaunch(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): DevDiscordLaunch {
  const forwarded: string[] = [];
  let scenarioRaw: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--scenario") {
      scenarioRaw = requireCliValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument !== undefined) {
      forwarded.push(argument);
    }
  }
  const scenario = DiscordSmokeScenarioNameSchema.parse(scenarioRaw);
  const botToken = environment["DISCORD_BOT_TOKEN"];
  if (botToken === undefined || botToken.length === 0) {
    throw new Error("dev:discord requires DISCORD_BOT_TOKEN");
  }
  const guildId = environment["SCOUT_DISCORD_SMOKE_GUILD_ID"];
  if (guildId === undefined || !/^\d{17,20}$/u.test(guildId)) {
    throw new Error("dev:discord requires SCOUT_DISCORD_SMOKE_GUILD_ID");
  }

  return {
    args: [
      "bun",
      "scripts/dev-web.ts",
      "--no-background-jobs",
      "--no-web",
      "--no-backend-watch",
      ...forwarded,
    ],
    environment: {
      ...environment,
      APPLICATION_ID: DERREJ_APPLICATION_ID,
      DISCORD_TOKEN: botToken,
      ENVIRONMENT: "dev",
      FEATURE_FLAGS_MODE: "static",
      FEATURE_FLAGS_STATIC_OVERRIDES: JSON.stringify(
        discordSmokeStaticOverrides(scenario),
      ),
      SCOUT_DEV_BACKEND_ENTRYPOINT: "src/dev-discord.ts",
      SCOUT_DEV_CONSUMER_PREVIEW: "false",
      SCOUT_DISCORD_SMOKE_SCENARIO: scenario,
    },
  };
}

if (import.meta.main) {
  const launch = buildDevDiscordLaunch(Bun.argv.slice(2), Bun.env);
  console.log(
    [
      "Scout Discord-only runtime",
      `Scenario: ${launch.environment["SCOUT_DISCORD_SMOKE_SCENARIO"] ?? "unset"}`,
      `Guild: ${launch.environment["SCOUT_DISCORD_SMOKE_GUILD_ID"] ?? "unset"}`,
      "Gateway: enabled",
      "Background jobs: disabled",
      "Report lake: disabled",
      "Vite: disabled",
      "Backend watch: disabled",
    ].join("\n"),
  );
  const child = Bun.spawn(launch.args, {
    cwd: import.meta.dir.replace(/\/scripts$/u, ""),
    env: launch.environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const stop = (): void => {
    child.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.exitCode = await child.exited;
}
