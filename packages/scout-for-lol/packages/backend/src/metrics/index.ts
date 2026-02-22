import { Registry, Counter, Gauge, Histogram } from "prom-client";
import configuration from "@scout-for-lol/backend/configuration.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("metrics");

logger.info("📊 Initializing Prometheus metrics");

/**
 * Custom Prometheus registry for Scout for LoL metrics
 * Internal - accessed via getMetrics() function
 */
const registry = new Registry();

/**
 * Add default labels to all metrics
 */
registry.setDefaultLabels({
  service: "scout-for-lol-backend",
  version: configuration.version,
  environment: configuration.environment,
  git_sha: configuration.gitSha,
});

// =======================
// Discord Bot Metrics
// =======================

/**
 * Total number of Discord commands received
 */
export const discordCommandsTotal = new Counter({
  name: "discord_commands_total",
  help: "Total number of Discord commands received",
  labelNames: ["command", "status"] as const,
  registers: [registry],
});

/**
 * Duration of Discord command execution in seconds
 */
export const discordCommandDuration = new Histogram({
  name: "discord_command_duration_seconds",
  help: "Duration of Discord command execution in seconds",
  labelNames: ["command"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

/**
 * Number of guilds the bot is currently in
 */
export const discordGuildsGauge = new Gauge({
  name: "discord_guilds",
  help: "Number of guilds the bot is currently in",
  registers: [registry],
});

/**
 * Number of users the bot can see
 */
export const discordUsersGauge = new Gauge({
  name: "discord_users",
  help: "Number of users the bot can see",
  registers: [registry],
});

/**
 * Discord WebSocket connection status (1 = connected, 0 = disconnected)
 */
export const discordConnectionStatus = new Gauge({
  name: "discord_connection_status",
  help: "Discord WebSocket connection status (1 = connected, 0 = disconnected)",
  registers: [registry],
});

/**
 * Discord WebSocket latency in milliseconds
 */
export const discordLatency = new Gauge({
  name: "discord_latency_ms",
  help: "Discord WebSocket latency in milliseconds",
  registers: [registry],
});

/**
 * Total number of Discord permission errors when attempting to send messages
 */
export const discordPermissionErrorsTotal = new Counter({
  name: "discord_permission_errors_total",
  help: "Total number of Discord permission errors when attempting to send messages",
  labelNames: ["guild_id", "error_type"] as const,
  registers: [registry],
});

/**
 * Total number of server owner notifications sent for permission errors
 */
export const discordOwnerNotificationsTotal = new Counter({
  name: "discord_owner_notifications_total",
  help: "Total number of server owner notifications sent for permission errors",
  labelNames: ["guild_id", "status"] as const,
  registers: [registry],
});

/**
 * Total number of abandoned guilds detected
 */
export const abandonedGuildsDetectedTotal = new Counter({
  name: "abandoned_guilds_detected_total",
  help: "Total number of guilds detected as abandoned due to persistent permission errors",
  registers: [registry],
});

/**
 * Total number of guilds the bot has left
 */
export const guildsLeftTotal = new Counter({
  name: "guilds_left_total",
  help: "Total number of guilds the bot has left",
  labelNames: ["reason"] as const,
  registers: [registry],
});

/**
 * Total number of abandonment notifications sent to guild owners
 */
export const abandonmentNotificationsTotal = new Counter({
  name: "abandonment_notifications_total",
  help: "Total number of abandonment notifications sent to guild owners",
  labelNames: ["status"] as const,
  registers: [registry],
});

/**
 * Total number of guild data cleanup operations
 */
export const guildDataCleanupTotal = new Counter({
  name: "guild_data_cleanup_total",
  help: "Total number of guild data cleanup operations",
  labelNames: ["data_type", "status"] as const,
  registers: [registry],
});

/**
 * Total number of subscriptions automatically cleaned up
 */
export const discordSubscriptionsCleanedTotal = new Counter({
  name: "discord_subscriptions_cleaned_total",
  help: "Total number of subscriptions automatically cleaned up",
  labelNames: ["reason"] as const,
  registers: [registry],
});

// =======================
// Cron Job Metrics
// =======================

/**
 * Total number of cron job executions
 */
export const cronJobExecutionsTotal = new Counter({
  name: "cron_job_executions_total",
  help: "Total number of cron job executions",
  labelNames: ["job_name", "status"] as const,
  registers: [registry],
});

/**
 * Duration of cron job execution in seconds
 */
export const cronJobDuration = new Histogram({
  name: "cron_job_duration_seconds",
  help: "Duration of cron job execution in seconds",
  labelNames: ["job_name"] as const,
  buckets: [1, 5, 10, 30, 60, 300, 600],
  registers: [registry],
});

/**
 * Timestamp of last successful cron job execution (Unix timestamp)
 */
export const cronJobLastSuccess = new Gauge({
  name: "cron_job_last_success_timestamp",
  help: "Timestamp of last successful cron job execution (Unix timestamp)",
  labelNames: ["job_name"] as const,
  registers: [registry],
});

/**
 * Total number of match history polling runs skipped due to mutex
 */
export const matchHistoryPollingSkipsTotal = new Counter({
  name: "match_history_polling_skips_total",
  help: "Total number of match history polling runs skipped due to mutex lock",
  labelNames: ["reason"] as const,
  registers: [registry],
});

// =======================
// Usage & Growth Metrics
// =======================

/**
 * Total number of players tracked across all servers
 */
export const playersTrackedTotal = new Gauge({
  name: "players_tracked_total",
  help: "Total number of players tracked across all servers",
  registers: [registry],
});

/**
 * Total number of League accounts tracked across all servers
 */
export const accountsTrackedTotal = new Gauge({
  name: "accounts_tracked_total",
  help: "Total number of League accounts tracked across all servers",
  registers: [registry],
});

/**
 * Number of active competitions (not cancelled)
 */
export const competitionsActiveTotal = new Gauge({
  name: "competitions_active_total",
  help: "Number of active competitions (not cancelled)",
  registers: [registry],
});

/**
 * Total number of competitions ever created
 */
export const competitionsTotalCreated = new Gauge({
  name: "competitions_total_created",
  help: "Total number of competitions ever created",
  registers: [registry],
});

/**
 * Total number of subscriptions across all servers
 */
export const subscriptionsTotal = new Gauge({
  name: "subscriptions_total",
  help: "Total number of active subscriptions across all servers",
  registers: [registry],
});

/**
 * Number of servers currently at their subscription limit
 */
export const serversAtSubscriptionLimit = new Gauge({
  name: "servers_at_subscription_limit",
  help: "Number of servers currently at their subscription limit",
  registers: [registry],
});

/**
 * Number of servers approaching their subscription limit (5 or fewer slots remaining)
 */
export const serversApproachingSubscriptionLimit = new Gauge({
  name: "servers_approaching_subscription_limit",
  help: "Number of servers approaching their subscription limit (5 or fewer slots remaining)",
  registers: [registry],
});

/**
 * Number of servers currently at their account limit
 */
export const serversAtAccountLimit = new Gauge({
  name: "servers_at_account_limit",
  help: "Number of servers currently at their account limit",
  registers: [registry],
});

/**
 * Number of servers approaching their account limit (5 or fewer slots remaining)
 */
export const serversApproachingAccountLimit = new Gauge({
  name: "servers_approaching_account_limit",
  help: "Number of servers approaching their account limit (5 or fewer slots remaining)",
  registers: [registry],
});

/**
 * Number of unique servers with data (have at least one player)
 */
export const serversWithDataTotal = new Gauge({
  name: "servers_with_data_total",
  help: "Number of unique servers that have at least one player tracked",
  registers: [registry],
});

/**
 * Number of accounts per region
 */
export const accountsByRegion = new Gauge({
  name: "accounts_by_region",
  help: "Number of accounts tracked per region",
  labelNames: ["region"] as const,
  registers: [registry],
});

/**
 * Number of competition participants (total enrollments)
 */
export const competitionParticipantsTotal = new Gauge({
  name: "competition_participants_total",
  help: "Total number of competition participants across all competitions",
  labelNames: ["status"] as const,
  registers: [registry],
});

/**
 * Average players per server
 */
export const avgPlayersPerServer = new Gauge({
  name: "avg_players_per_server",
  help: "Average number of players per server",
  registers: [registry],
});

/**
 * Average accounts per player
 */
export const avgAccountsPerPlayer = new Gauge({
  name: "avg_accounts_per_player",
  help: "Average number of accounts per player",
  registers: [registry],
});

// =======================
// Riot API Metrics
// =======================

/**
 * Total number of Riot API requests
 */
export const riotApiRequestsTotal = new Counter({
  name: "riot_api_requests_total",
  help: "Total Riot API requests",
  labelNames: ["source", "status"] as const,
  registers: [registry],
});

/**
 * Total number of match reports generated
 */
export const reportsGeneratedTotal = new Counter({
  name: "reports_generated_total",
  help: "Total match reports generated",
  labelNames: ["queue_type"] as const,
  registers: [registry],
});

/**
 * Total number of match report generation failures
 */
export const reportsFailedTotal = new Counter({
  name: "reports_failed_total",
  help: "Total match report generation failures",
  labelNames: ["queue_type"] as const,
  registers: [registry],
});

/**
 * Total number of database queries
 */
export const databaseQueriesTotal = new Counter({
  name: "database_queries_total",
  help: "Total database queries",
  labelNames: ["operation"] as const,
  registers: [registry],
});

// =======================
// Riot API Health State
// =======================

let lastSuccessfulRiotApiCall: number | undefined;
let lastRiotApiAttempt: number | undefined;

export function updateRiotApiHealth(success: boolean): void {
  lastRiotApiAttempt = Date.now();
  if (success) {
    lastSuccessfulRiotApiCall = Date.now();
  }
}

export function getRiotApiHealth(): {
  lastSuccessTimestamp: number | undefined;
  lastAttemptTimestamp: number | undefined;
} {
  return {
    lastSuccessTimestamp: lastSuccessfulRiotApiCall,
    lastAttemptTimestamp: lastRiotApiAttempt,
  };
}

// =======================
// Application Metrics
// =======================

/**
 * Application uptime in seconds
 * Internal - updated by updateUptimeMetric()
 */
const applicationUptime = new Gauge({
  name: "application_uptime_seconds",
  help: "Application uptime in seconds",
  registers: [registry],
});

/**
 * Total number of unhandled errors
 */
export const unhandledErrorsTotal = new Counter({
  name: "unhandled_errors_total",
  help: "Total number of unhandled errors",
  labelNames: ["error_type"] as const,
  registers: [registry],
});

/**
 * Total number of Riot API errors by source and HTTP status
 */
export const riotApiErrorsTotal = new Counter({
  name: "riot_api_errors_total",
  help: "Total number of Riot API errors by source and HTTP status",
  labelNames: ["source", "http_status"] as const,
  registers: [registry],
});

// Track application start time for uptime calculation
const applicationStartTime = Date.now();

/**
 * Update the application uptime metric
 * Internal - called by getMetrics()
 */
function updateUptimeMetric(): void {
  const uptimeSeconds = (Date.now() - applicationStartTime) / 1000;
  applicationUptime.set(uptimeSeconds);
}

// Update uptime every 10 seconds
setInterval(() => {
  updateUptimeMetric();
}, 10_000);

logger.info("✅ Prometheus metrics initialized successfully");

// Import and initialize usage metrics collection
// This must be after all metric definitions to avoid circular dependencies
import "@scout-for-lol/backend/metrics/usage.ts";

/**
 * Get all metrics as Prometheus-formatted text
 * Public API for exporting metrics to Prometheus
 */
export async function getMetrics(): Promise<string> {
  // Dynamic import to avoid circular dependency issues
  const { updateUsageMetrics } = await import("./usage.js");
  const { updateLimitMetrics } = await import("./limits.js");
  updateUptimeMetric();
  await updateUsageMetrics();
  await updateLimitMetrics();
  return await registry.metrics();
}
