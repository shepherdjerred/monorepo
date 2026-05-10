import { Client } from "discord.js";
import { GATEWAY_INTENTS, PARTIALS } from "./intents.ts";

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

export async function destroyDiscordClient(): Promise<void> {
  if (client != null) {
    await client.destroy();
    client = null;
  }
}
