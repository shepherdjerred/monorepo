import { Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Age of the newest Discord gateway heartbeat acknowledgement, in seconds.
 *
 * This is the alertable form of a signal `discord_latency_ms` hides. A zombie
 * gateway keeps reporting its last measured latency forever, so that series
 * still looks healthy while the bot receives nothing and every slash command
 * answers "The application did not respond". The *age* of the acknowledgement
 * that produced the number climbs without bound instead, so an alert on this
 * gauge fires where an alert on latency never could. Normal operation keeps it
 * below Discord's 41.25s heartbeat interval.
 */
export const discordGatewayHeartbeatAge = new Gauge({
  name: "discord_gateway_heartbeat_age_seconds",
  help: "Seconds since the newest Discord gateway heartbeat acknowledgement",
  registers: [registry],
});
