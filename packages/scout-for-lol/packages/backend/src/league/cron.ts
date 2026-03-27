import { checkPostMatch } from "#src/league/tasks/postmatch/index.ts";
import { runLifecycleCheck } from "#src/league/tasks/competition/lifecycle.ts";
import { runDailyLeaderboardUpdate } from "#src/league/tasks/competition/daily-update.ts";
import { runPlayerPruning } from "#src/league/tasks/cleanup/prune-players.ts";
import { checkAbandonedGuilds } from "#src/league/tasks/cleanup/abandoned-guilds.ts";
import { runDataValidation } from "#src/league/tasks/cleanup/validate-data.ts";
import { refreshMatchTimes } from "#src/league/tasks/maintenance/refresh-match-times.ts";
import { runWeeklyPairingUpdate } from "#src/league/tasks/pairing/index.ts";
import { runOutreach } from "#src/league/tasks/outreach/index.ts";
import { client } from "#src/discord/client.ts";
import { createCronJob } from "#src/league/cron/helpers.ts";
import { createLogger } from "#src/logger.ts";
import { getFlag, MY_SERVER } from "#src/configuration/flags.ts";
import { runStartupRecovery } from "#src/league/tasks/recovery/startup-recovery.ts";

const logger = createLogger("league-cron");

export async function startCronJobs() {
  logger.info("⏰ Running startup recovery before cron initialization");
  await runStartupRecovery();

  logger.info("⏰ Initializing cron job scheduler");

  // check match history every minute
  logger.info("📅 Setting up match history polling job (every minute at :00)");
  createCronJob({
    schedule: "0 * * * * *",
    jobName: "post_match_check",
    task: checkPostMatch,
    logMessage: "🔍 Running post-match check task",
    timezone: "America/Los_Angeles",
    runOnInit: true,
  });

  // check competition lifecycle every 15 minutes
  logger.info("📅 Setting up competition lifecycle job (every 15 minutes)");
  createCronJob({
    schedule: "0 */15 * * * *",
    jobName: "competition_lifecycle",
    task: runLifecycleCheck,
    logMessage: "🏆 Running competition lifecycle check",
    timezone: "America/Los_Angeles",
    runOnInit: false, // Don't run on init - prevents startup notifications
    logTrigger: "Checking for competitions to start/end",
  });

  // validate data (cleanup orphaned guilds/channels) every hour
  logger.info("📅 Setting up data validation job (every hour at :00)");
  createCronJob({
    schedule: "0 0 * * * *",
    jobName: "data_validation",
    task: () => runDataValidation(client),
    logMessage: "🔍 Running data validation",
    timezone: "America/Los_Angeles",
    runOnInit: true,
  });

  // post daily leaderboard updates at midnight UTC
  logger.info("📅 Setting up daily leaderboard update job (midnight UTC)");
  createCronJob({
    schedule: "0 0 0 * * *",
    jobName: "daily_leaderboard_update",
    task: runDailyLeaderboardUpdate,
    logMessage: "📊 Running daily leaderboard update",
    timezone: "UTC",
    runOnInit: false, // Don't run on init - prevents startup notifications
    logTrigger: "Posting daily leaderboard updates for active competitions",
  });

  // prune orphaned players daily at 3 AM UTC
  logger.info("📅 Setting up daily player pruning job (3 AM UTC)");
  createCronJob({
    schedule: "0 0 3 * * *",
    jobName: "player_pruning",
    task: runPlayerPruning,
    logMessage: "🧹 Running player pruning task",
    timezone: "UTC",
    runOnInit: true,
  });

  // check for abandoned guilds daily at 4 AM UTC (after player pruning)
  logger.info("📅 Setting up abandoned guild cleanup job (4 AM UTC)");
  createCronJob({
    schedule: "0 0 4 * * *",
    jobName: "abandoned_guild_cleanup",
    task: () => checkAbandonedGuilds(client),
    logMessage: "🧹 Running abandoned guild cleanup",
    timezone: "UTC",
    runOnInit: true,
  });

  // refresh match times every 6 hours (runs on startup + periodically)
  // This ensures all accounts have accurate lastMatchTime for proper polling intervals
  logger.info("📅 Setting up match time refresh job (every 6 hours)");
  createCronJob({
    schedule: "0 0 */6 * * *",
    jobName: "refresh_match_times",
    task: refreshMatchTimes,
    logMessage: "🔄 Refreshing match times for stale accounts",
    timezone: "UTC",
    runOnInit: true, // Run on startup to fix any stale data
  });

  // post weekly Common Denominator update every Sunday at 6 PM UTC
  // Shows pairing win rates and surrender stats for the past month
  // Gated by common_denominator_enabled flag (currently only enabled for MY_SERVER)
  logger.info("📅 Setting up weekly pairing update job (Sunday 6 PM UTC)");
  createCronJob({
    schedule: "0 0 18 * * 0", // 6 PM UTC on Sundays
    jobName: "weekly_pairing_update",
    task: async () => {
      const isEnabled = getFlag("common_denominator_enabled", {
        server: MY_SERVER,
      });
      if (!isEnabled) {
        logger.info(
          "📈 Common Denominator update skipped - feature not enabled for this server",
        );
        return;
      }
      await runWeeklyPairingUpdate();
    },
    logMessage: "📈 Running weekly Common Denominator update",
    timezone: "UTC",
    runOnInit: false, // Don't run on init - prevents startup notifications
    logTrigger: "Posting weekly pairing win rates and surrender stats",
  });

  // run outreach checks daily at 10 AM UTC
  logger.info("📅 Setting up outreach check job (daily 10 AM UTC)");
  createCronJob({
    schedule: "0 0 10 * * *",
    jobName: "outreach_check",
    task: () => runOutreach(client),
    logMessage: "📬 Running outreach check",
    timezone: "UTC",
    runOnInit: false,
  });

  logger.info("✅ Cron jobs initialized successfully");
  logger.info(
    "📊 Match history polling (1min), competition lifecycle (15min), data validation (hourly), " +
      "match time refresh (6hr), daily leaderboard (midnight UTC), player pruning (3AM UTC), " +
      "abandoned guild cleanup (4AM UTC), and weekly pairing update (Sunday 6PM UTC) cron jobs are now active",
  );
}
