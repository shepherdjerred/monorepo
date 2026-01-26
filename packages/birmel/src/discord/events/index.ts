import type { Client } from "discord.js";
import { setupReadyHandler } from "./ready.js";
import { setupMessageCreateHandler } from "./message-create.js";
import { setupGuildCreateHandler } from "./guild-create.js";
import { setupGuildDeleteHandler } from "./guild-delete.js";
import { handleReactionAdd } from "./reaction-add.js";
import { handleVoiceStateUpdate } from "./voice-state-update.js";
import { setupInteractionHandler } from "./interaction-create.js";

export function registerEventHandlers(client: Client): void {
  setupReadyHandler(client);
  setupMessageCreateHandler(client);
  setupGuildCreateHandler(client);
  setupGuildDeleteHandler(client);
  handleReactionAdd(client);
  handleVoiceStateUpdate(client);
  setupInteractionHandler(client);
}

export { setMessageHandler, type MessageContext, type MessageHandler } from "./message-create.js";
