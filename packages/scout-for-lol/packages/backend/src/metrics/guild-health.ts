/**
 * Guild-health gauges (set every 5 min from the DB in updateUsageMetrics).
 * Surfaces servers that have the bot but can't be delivered to, and competitions
 * whose leaderboard reports are failing. Kept separate from index.ts for the
 * file-length cap; registered on the shared registry.
 */

import { Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * 1 per guild that currently has an active send-failure streak (the bot is
 * present but can't deliver messages). Join with `guild_info` for the name.
 */
export const guildSendBlocked = new Gauge({
  name: "guild_send_blocked",
  help: "1 for each guild where the bot is a member but message delivery is currently failing",
  labelNames: ["server_id"] as const,
  registers: [registry],
});

/** Count of guilds with an active send-failure streak (headline number). */
export const guildSendBlockedTotal = new Gauge({
  name: "guild_send_blocked_total",
  help: "Number of guilds where the bot is present but message delivery is currently failing",
  registers: [registry],
});

/**
 * 1 per active competition that is unhealthy (its leaderboard report failed or
 * is overdue / never delivered).
 */
export const competitionUnhealthy = new Gauge({
  name: "competition_unhealthy",
  help: "1 for each active competition whose leaderboard report is failing or overdue",
  labelNames: ["server_id", "competition_id"] as const,
  registers: [registry],
});

/** Count of unhealthy active competitions (headline number). */
export const competitionUnhealthyTotal = new Gauge({
  name: "competition_unhealthy_total",
  help: "Number of active competitions whose leaderboard report is failing or overdue",
  registers: [registry],
});

/**
 * Info metric carrying the human-readable server name, for joining against the
 * opaque `server_id` labels above (`* on(server_id) group_left(server_name)`).
 */
export const guildInfo = new Gauge({
  name: "guild_info",
  help: "Static info series mapping server_id to server_name",
  labelNames: ["server_id", "server_name"] as const,
  registers: [registry],
});

/**
 * 1 per guild that has the bot installed but has configured nothing — no
 * subscriptions and no active competitions — so nothing will ever post.
 */
export const guildUnconfigured = new Gauge({
  name: "guild_unconfigured",
  help: "1 for each installed guild with zero subscriptions and zero active competitions",
  labelNames: ["server_id"] as const,
  registers: [registry],
});

/** Count of installed-but-unconfigured guilds (headline number). */
export const guildUnconfiguredTotal = new Gauge({
  name: "guild_unconfigured_total",
  help: "Number of installed guilds with zero subscriptions and zero active competitions",
  registers: [registry],
});
