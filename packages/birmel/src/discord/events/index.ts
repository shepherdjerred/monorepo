import type { Client } from "discord.js";
import { setupReadyHandler } from "./ready.ts";
import { setupMessageCreateHandler } from "./message-create.ts";
import { setupGuildCreateHandler } from "./guild-create.ts";
import { setupGuildDeleteHandler } from "./guild-delete.ts";
import { handleReactionAdd } from "./reaction-add.ts";
import { setupInteractionHandler } from "./interaction-create.ts";

export function registerEventHandlers(client: Client): void {
  setupReadyHandler(client);
  setupMessageCreateHandler(client);
  setupGuildCreateHandler(client);
  setupGuildDeleteHandler(client);
  handleReactionAdd(client);
  setupInteractionHandler(client);
}
