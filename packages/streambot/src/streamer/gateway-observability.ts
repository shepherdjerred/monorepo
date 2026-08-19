import type { Client } from "discord.js-selfbot-v13";
import { gatewayDisruptionsTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("streamer");

/** Surface userbot gateway loss separately from the voice-connection recovery path. */
export function observeUserbotGateway(client: Client): void {
  client.on("shardDisconnect", (event) => {
    gatewayDisruptionsTotal.inc({ client: "userbot", kind: "disconnect" });
    log.warn("userbot gateway shard disconnected", { code: event.code });
  });
  client.on("invalidated", () => {
    gatewayDisruptionsTotal.inc({ client: "userbot", kind: "invalidated" });
    log.error(
      "userbot gateway session invalidated — streaming is dead until the process restarts",
    );
  });
  client.on("error", (error) => {
    gatewayDisruptionsTotal.inc({ client: "userbot", kind: "error" });
    log.warn("userbot client error", { error: getErrorMessage(error) });
  });
}
