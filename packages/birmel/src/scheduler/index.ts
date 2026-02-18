import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/index.ts";
import { checkAndSendDailyPosts } from "./daily-posts.ts";

const logger = loggers.scheduler;

import { runAnnouncementsJob } from "./jobs/announcements.ts";
import { checkAndPostBirthdays } from "./jobs/birthday-checker.ts";
import { aggregateActivityMetrics } from "./jobs/activity-aggregator.ts";
import {
  checkAndStartElections,
  checkAndEndElections,
  processElectionResults,
} from "./jobs/elections.ts";
import { runScheduledTasksJob } from "./jobs/scheduled-tasks.ts";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  const config = getConfig();

  if (!config.dailyPosts.enabled) {
    logger.info("Daily posts scheduler is disabled");
    return;
  }

  // Check every minute for due posts and announcements
  schedulerInterval = setInterval(() => {
    void checkAndSendDailyPosts();
    void runAnnouncementsJob();
    void checkAndPostBirthdays();
    void aggregateActivityMetrics();
    void checkAndStartElections();
    void checkAndEndElections();
    void processElectionResults();
    void runScheduledTasksJob();
  }, 60 * 1000);

  // Also run immediately on startup
  void checkAndSendDailyPosts();
  void runAnnouncementsJob();
  void checkAndPostBirthdays();
  void aggregateActivityMetrics();
  void checkAndStartElections();
  void runScheduledTasksJob();

  logger.info("Scheduler started");
}

export function stopScheduler(): void {
  if (schedulerInterval != null) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info("Scheduler stopped");
  }
}



export {
  configureDailyPost,
  disableDailyPost,
  checkAndSendDailyPosts,
} from "./daily-posts.ts";
export { runServerSummaryJob } from "./jobs/server-summary.ts";
export {
  scheduleAnnouncement,
  cancelAnnouncement,
  listPendingAnnouncements,
  runAnnouncementsJob,
} from "./jobs/announcements.ts";
export { checkAndPostBirthdays } from "./jobs/birthday-checker.ts";
export { aggregateActivityMetrics } from "./jobs/activity-aggregator.ts";

export {checkAndStartElections} from "./jobs/elections.ts";
export {checkAndEndElections, processElectionResults} from "./jobs/elections.ts";
export {runScheduledTasksJob} from "./jobs/scheduled-tasks.ts";