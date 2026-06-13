import { REST, Routes } from "npm:discord.js@14.14.1";
import Configuration from "../configuration.ts";
import { karmaCommand } from "../karma/commands.ts";
import { customsCommand } from "../customs/commands.ts";
import { musicCommand } from "../music/commands.ts";

// the commands API is rate limited.
// we only need to update commands when the interfaces have changed.
const updateCommands = false;

const rest = new REST({ version: "10" }).setToken(Configuration.discordToken);

try {
  if (updateCommands) {
    const commands = [
      karmaCommand.toJSON(),
      musicCommand.toJSON(),
      customsCommand.toJSON(),
    ];
    console.log(commands);
    await rest.put(Routes.applicationCommands(Configuration.applicationId), {
      body: commands,
    });
  }
} catch (error) {
  console.error(error);
}
