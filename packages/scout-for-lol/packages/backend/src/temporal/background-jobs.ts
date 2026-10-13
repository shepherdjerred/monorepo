import { Context } from "@temporalio/activity";
import { client } from "#src/discord/client.ts";
import {
  unavailable,
  type NonSupportBackgroundJobInput,
} from "#src/temporal/activity-runtime.ts";

export async function runBackgroundJobByKind(
  input: NonSupportBackgroundJobInput,
): Promise<void> {
  switch (input.kind) {
    case "competition-refresh": {
      const { runLifecycleCheck } =
        await import("#src/league/tasks/competition/lifecycle.ts");
      await runLifecycleCheck();
      break;
    }
    case "competition-scheduled-updates": {
      const { runScheduledCompetitionUpdates } =
        await import("#src/league/tasks/competition/scheduled-update-dispatcher.ts");
      await runScheduledCompetitionUpdates();
      break;
    }
    case "competition-validation": {
      const { runDataValidation } =
        await import("#src/league/tasks/cleanup/validate-data.ts");
      await runDataValidation(client);
      break;
    }
    case "bucks-reconciliation": {
      const { reconcileBucksBalances } =
        await import("#src/betting/settlement/reconcile.ts");
      await reconcileBucksBalances();
      break;
    }
    case "weekly-bucks-leaderboard": {
      const { runWeeklyBucksLeaderboard } =
        await import("#src/betting/leaderboard/weekly-leaderboard.ts");
      // First scheduling time is stable across Activity retries, including a
      // retry crossing the leaderboard's week boundary.
      await runWeeklyBucksLeaderboard(
        undefined,
        new Date(Context.current().info.scheduledTimestampMs),
      );
      break;
    }
    case "player-pruning": {
      const { runPlayerPruning } =
        await import("#src/league/tasks/cleanup/prune-players.ts");
      await runPlayerPruning();
      break;
    }
    case "removed-guild-cleanup": {
      const { reconcileRemovedGuilds } =
        await import("#src/league/tasks/cleanup/reconcile-removed-guilds.ts");
      await reconcileRemovedGuilds(client);
      break;
    }
    case "match-time-rebuild": {
      const { refreshMatchTimes } =
        await import("#src/league/tasks/maintenance/refresh-match-times.ts");
      await refreshMatchTimes();
      break;
    }
    case "outreach": {
      const { runOutreach } =
        await import("#src/league/tasks/outreach/index.ts");
      await runOutreach(client, {
        occurredAt: new Date(Context.current().info.scheduledTimestampMs),
      });
      break;
    }
    case "conversion-check": {
      const { updateOutreachConversionMetrics } =
        await import("#src/league/tasks/outreach/conversions.ts");
      await updateOutreachConversionMetrics();
      break;
    }
    case "summoner-index-backfill": {
      const { backfillFromExisting } =
        await import("#src/lib/riot/summoner-index.ts");
      await backfillFromExisting();
      break;
    }
    case "custom-nights-expiry": {
      const { expireCustomNights } =
        await import("#src/customs/game/expiry.ts");
      await expireCustomNights();
      break;
    }
    case "notification-intent-expiry": {
      const { runNotificationIntentExpiry } =
        await import("#src/durable/match/intent-expiry.ts");
      await runNotificationIntentExpiry();
      const { settleTerminalNotificationTips } =
        await import("#src/temporal/notification/notification-presentation.ts");
      await settleTerminalNotificationTips();
      const { repairProductAnnouncementFollowUps } =
        await import("#src/temporal/notification/product/follow-up.ts");
      await repairProductAnnouncementFollowUps();
      break;
    }
    case "progression-reconciliation": {
      const { reconcileCompetitiveProgression } =
        await import("#src/progression/reconcile.ts");
      await reconcileCompetitiveProgression(input.stage);
      break;
    }
    case "mvp-tally-refresh": {
      const { reconcilePendingMvpTallyRefreshes } =
        await import("#src/mvp-votes/tally-reconciliation.ts");
      await reconcilePendingMvpTallyRefreshes();
      break;
    }
    case "clash-snapshot": {
      const { runClashSnapshot } =
        await import("#src/league/clash/snapshot.ts");
      await runClashSnapshot();
      break;
    }
    case "prediction-ingest":
    case "legacy-backfill":
      unavailable(input.kind);
  }
}
