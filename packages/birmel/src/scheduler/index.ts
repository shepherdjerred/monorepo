import { getConfig } from "../config/index.js";
import { loggers } from "../utils/index.js";
import { checkAndSendDailyPosts, configureDailyPost, disableDailyPost } from "./daily-posts.js";

const logger = loggers.scheduler;
import { runServerSummaryJob } from "./jobs/server-summary.js";
import {
  runAnnouncementsJob,
  scheduleAnnouncement,
  cancelAnnouncement,
  listPendingAnnouncements,
} from "./jobs/announcements.js";
import { checkAndPostBirthdays } from "./jobs/birthday-checker.js";
import { aggregateActivityMetrics } from "./jobs/activity-aggregator.js";
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
    void runScheduledTasksJob();
  }, 60 * 1000);

  // Also run immediately on startup
  void checkAndSendDailyPosts();
  void runAnnouncementsJob();
  void checkAndPostBirthdays();
  void aggregateActivityMetrics();
  void runScheduledTasksJob();

  logger.info("Scheduler started");
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info("Scheduler stopped");
  }
}

export {
  configureDailyPost,
  disableDailyPost,
  checkAndSendDailyPosts,
  runServerSummaryJob,
  runAnnouncementsJob,
  scheduleAnnouncement,
  cancelAnnouncement,
  listPendingAnnouncements,
  checkAndPostBirthdays,
  aggregateActivityMetrics,
  runScheduledTasksJob,
};
