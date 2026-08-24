import { Client, GatewayIntentBits } from "discord.js";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-client");

logger.info("🔌 Initializing Discord client");

/**
 * The Discord gateway client.
 *
 * This module deliberately does nothing but construct it. Event handlers and
 * login live in `bootstrap.ts`, for two reasons:
 *
 * - Around eighteen modules import this client purely to send a message or
 *   read a guild. Wiring the handlers here meant every one of them pulled in
 *   the whole interaction router, and the router pulls those same modules back
 *   — an eager import cycle through `client -> interactions -> commands ->
 *   feature -> client`.
 * - Login used to be a top-level `await` in this file, so importing the client
 *   from a tRPC router was enough to connect to Discord. Connecting is now an
 *   explicit act performed by the composition root.
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // Required for voice
    GatewayIntentBits.GuildModeration, // Required for audit log (installer tracking)
  ],
});

export { client };
