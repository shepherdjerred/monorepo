import { getConfig } from "../config/index.js";
import { loggers } from "../utils/index.js";
import { checkAndSendDailyPosts } from "./daily-posts.js";

const logger = loggers.scheduler;

import { runAnnouncementsJob } from "./jobs/announcements.js";
import { checkAndPostBirthdays } from "./jobs/birthday-checker.js";
import { aggregateActivityMetrics } from "./jobs/activity-aggregator.js";
import {
  checkAndStartElections,
  checkAndEndElections,
  processElectionResults,
} from "./jobs/elections.js";
import { runScheduledTasksJob } from "./jobs/scheduled-tasks.js";

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
  checkAndStartElections,
  checkAndEndElections,
  processElectionResults,
  runScheduledTasksJob,
};

export {
  configureDailyPost,
  disableDailyPost,
  checkAndSendDailyPosts,
} from "./daily-posts.js";
export { runServerSummaryJob } from "./jobs/server-summary.js";
export {
  scheduleAnnouncement,
  cancelAnnouncement,
  listPendingAnnouncements,
  runAnnouncementsJob,
} from "./jobs/announcements.js";
export { checkAndPostBirthdays } from "./jobs/birthday-checker.js";
export { aggregateActivityMetrics } from "./jobs/activity-aggregator.js";
