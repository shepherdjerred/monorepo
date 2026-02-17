import { Events } from "npm:discord.js@14.14.1";
import { handleKarma } from "../karma/commands.ts";
import "./rest.ts";
import client from "./client.ts";
import { handleCustoms } from "../customs/commands.ts";
import { handleMusic } from "../music/commands.ts";

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    switch (interaction.commandName) {
      case "karma":
        await handleKarma(interaction);
        break;
      case "music":
        await handleMusic(interaction);
        break;
      case "customs":
        await handleCustoms(interaction);
        break;
    }
  } catch (e) {
    console.error(e);
  }
});
