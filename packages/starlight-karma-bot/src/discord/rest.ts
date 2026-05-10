import { REST, Routes } from "discord.js";
import Configuration from "#src/configuration.ts";
import { karmaCommand } from "#src/karma/commands.ts";

const rest = new REST({ version: "10" }).setToken(Configuration.discordToken);

try {
  const commands = [karmaCommand.toJSON()];
  console.warn("[Discord Commands] Updating slash commands...");
  console.warn(
    `[Discord Commands] Registering ${commands.length.toString()} command(s):`,
    commands.map((c) => c.name).join(", "),
  );
  await rest.put(Routes.applicationCommands(Configuration.applicationId), {
    body: commands,
  });
  console.warn("[Discord Commands] Successfully updated application commands");
} catch (error) {
  console.error("[Discord Commands] Failed to update commands:", error);
}
