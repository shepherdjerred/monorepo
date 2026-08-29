import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { resolveEnvironment } from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import {
  applyDiscordSmokeScenario,
  DiscordSmokeScenarioNameSchema,
} from "#src/discord-smoke-scenarios.ts";

const logger = createLogger("discord-smoke");

if (resolveEnvironment() !== "dev") {
  throw new Error(
    "The Discord smoke entrypoint may run only in ENVIRONMENT=dev",
  );
}

const scenario = DiscordSmokeScenarioNameSchema.parse(
  Bun.env["SCOUT_DISCORD_SMOKE_SCENARIO"],
);
const guildId = DiscordGuildIdSchema.parse(
  Bun.env["SCOUT_DISCORD_SMOKE_GUILD_ID"],
);
applyDiscordSmokeScenario(scenario, guildId);

await import("#src/index.ts");

const readyPath = Bun.env["SCOUT_DISCORD_SMOKE_READY_PATH"];
if (readyPath !== undefined && readyPath.length > 0) {
  await Bun.write(
    readyPath,
    `${JSON.stringify({ guildId, processId: process.pid, scenario })}\n`,
  );
  logger.info(`Scout Discord smoke runtime ready: ${readyPath}`);
}
