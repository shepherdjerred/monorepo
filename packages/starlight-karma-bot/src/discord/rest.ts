import { REST, Routes } from "discord.js";
import Configuration from "../configuration.ts";
import { karmaCommand } from "../karma/commands.ts";

// the commands API is rate limited.
// we only need to update commands when the interfaces have changed.
const updateCommands = true;

const rest = new REST({ version: "10" }).setToken(Configuration.discordToken);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (updateCommands) {
  try {
    const commands = [karmaCommand.toJSON()];
    console.log("[Discord Commands] Updating slash commands...");
    console.log(
      `[Discord Commands] Registering ${commands.length.toString()} command(s):`,
      commands.map((c) => c.name).join(", "),
    );
    await rest.put(Routes.applicationCommands(Configuration.applicationId), {
      body: commands,
    });
    console.log("[Discord Commands] Successfully updated application commands");
  } catch (error) {
    console.error("[Discord Commands] Failed to update commands:", error);
  }
}
