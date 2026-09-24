import type { ErrorEvent, EventHint } from "@sentry/bun";

/**
 * discord.js gateway handshake failures (`Events.Error` / `Events.ShardError`
 * in `discord/client.ts`). The handlers still log and the shard lifecycle
 * handlers still flip the gateway state — only the Sentry event is noise.
 */
const DISCORD_GATEWAY_NOISE_SOURCES = new Set([
  "discord-client",
  "discord-shard",
]);
const DISCORD_GATEWAY_NOISE_PATTERN = /^WebSocket connection to .* failed/;

/**
 * Sentry `beforeSend` filter for the karma bot.
 */
export function filterStarlightSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  const source = event.tags?.["source"];
  const original = hint.originalException;
  const isGatewayNoise =
    typeof source === "string" &&
    DISCORD_GATEWAY_NOISE_SOURCES.has(source) &&
    original instanceof Error &&
    DISCORD_GATEWAY_NOISE_PATTERN.test(original.message);
  return isGatewayNoise ? null : event;
}
