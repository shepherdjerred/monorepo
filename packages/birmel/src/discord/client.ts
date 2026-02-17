import { Client } from "discord.js";
import { GATEWAY_INTENTS, PARTIALS } from "./intents.js";

let client: Client | null = null;

export function getDiscordClient(): Client {
  client ??= new Client({
    intents: [...GATEWAY_INTENTS],
    partials: [...PARTIALS],
    failIfNotExists: false,
    rest: {
      timeout: 30_000,
      retries: 3,
    },
  });
  return client;
}

export function destroyDiscordClient(): Promise<void> {
  if (client) {
    return client.destroy().then(() => {
      client = null;
    });
  }
  return Promise.resolve();
}
