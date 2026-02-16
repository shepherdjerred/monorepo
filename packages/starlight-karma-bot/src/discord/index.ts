import { Events } from "discord.js";
import { handleKarma } from "../karma/commands.ts";
import "./rest.ts";
import client from "./client.ts";

client.on(Events.InteractionCreate, (interaction) => {
  void (async () => {
    try {
      if (!interaction.isChatInputCommand()) {
        return;
      }
      console.log(
        `[Command] User ${interaction.user.tag} (${interaction.user.id}) executed command: /${interaction.commandName}`,
      );
      switch (interaction.commandName) {
        case "karma":
          await handleKarma(interaction);
          break;
      }
    } catch (e) {
      console.error(e);
    }
  })();
});
