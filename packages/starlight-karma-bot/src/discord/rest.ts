import { REST, Routes } from "discord.js";
import Configuration from "#src/configuration.ts";
import { karmaCommand } from "#src/karma/commands.ts";

const rest = new REST({ version: "10" }).setToken(Configuration.discordToken);

const commands = [karmaCommand.toJSON()];
console.warn("[Discord Commands] Updating slash commands...");
console.warn(
  `[Discord Commands] Registering ${commands.length.toString()} command(s):`,
  commands.map((c) => c.name).join(", "),
);
// Deliberately unguarded: a bot whose commands failed to register cannot do
// anything useful, so this must fail startup rather than log and continue.
// The liveness probe recycles the pod, which retries the registration.
await rest.put(Routes.applicationCommands(Configuration.applicationId), {
  body: commands,
});
console.warn("[Discord Commands] Successfully updated application commands");
