import { Client as SelfbotClient } from "discord.js-selfbot-v13";
import type { PooledUserbot, PooledUserbotFactory } from "./pooled-userbot.ts";

/**
 * Default `PooledUserbot` implementation backed by `discord.js-selfbot-v13`. Game drivers
 * read the raw `client` off `userbot.client` to drive voice + streaming.
 */
export type SelfbotPooledUserbot = PooledUserbot & {
  /** Raw selfbot client — drivers use this to join voice + push frames. */
  readonly client: SelfbotClient;
};

/** Default factory: build a pooled userbot from a token. Pass as `factory` to `UserbotPool`. */
export function createSelfbotPooledUserbotFactory(): PooledUserbotFactory<SelfbotPooledUserbot> {
  return createSelfbotPooledUserbot;
}

/** Build a single pooled userbot (without a pool around it — useful for tests). */
export function createSelfbotPooledUserbot(
  token: string,
): SelfbotPooledUserbot {
  const client = new SelfbotClient();
  return {
    client,
    login: async () => {
      const ready = new Promise<void>((resolve) => {
        client.once("ready", () => {
          resolve();
        });
      });
      await client.login(token);
      await ready;
    },
    userId: () => {
      const id = client.user?.id;
      if (id === undefined) {
        throw new Error("selfbot client is not logged in yet");
      }
      return id;
    },
    guildIds: () => [...client.guilds.cache.keys()],
    destroy: async () => {
      try {
        client.destroy();
      } catch {
        // discord.js-selfbot-v13's destroy throws when the gateway never opened or already closed —
        // harmless during shutdown; the goal is just to release sockets.
      }
      await Promise.resolve();
    },
  };
}
