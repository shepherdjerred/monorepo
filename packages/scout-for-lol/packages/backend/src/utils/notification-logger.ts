import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("notification-logger");

/**
 * Unique instance ID for this bot process
 * Helps identify if multiple instances are running
 */
const INSTANCE_ID = crypto.randomUUID().slice(0, 8);

/**
 * Log directory for notification tracking
 */
const LOG_DIR = Bun.env["LOG_DIR"] ?? "./logs";
const LOG_FILE = `${LOG_DIR}/competition-notifications.log`;

/**
 * Initialize logging directory
 */
async function ensureLogDir(): Promise<void> {
  if (!(await Bun.file(LOG_DIR).exists())) {
    await Bun.write(`${LOG_DIR}/.keep`, "");
  }
}

/**
 * Notification types we're tracking
 */
export type NotificationType =
  | "COMPETITION_STARTED"
  | "COMPETITION_ENDED"
  | "DAILY_LEADERBOARD"
  | "SNAPSHOT_ERROR"
  | "CRON_TRIGGER";

/**
 * Log entry structure
 */
type LogEntry = {
  timestamp: string;
  instanceId: string;
  type: NotificationType;
  competitionId?: number;
  competitionTitle?: string;
  channelId?: string;
  serverId?: string;
  trigger: string;
  message?: string;
};

/**
 * Format log entry for writing
 */
function formatLogEntry(entry: LogEntry): string {
  return JSON.stringify(entry, null, 0); // Single line JSON
}

/**
 * Log a notification event to both console and file
 */
export function logNotification(
  type: NotificationType,
  trigger: string,
  details: {
    competitionId?: number;
    competitionTitle?: string;
    channelId?: string;
    serverId?: string;
    message?: string;
  } = {},
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    instanceId: INSTANCE_ID,
    type,
    trigger,
    ...details,
  };

  // Console log
  const emoji = {
    COMPETITION_STARTED: "🎯",
    COMPETITION_ENDED: "🏆",
    DAILY_LEADERBOARD: "📊",
    SNAPSHOT_ERROR: "⚠️",
    CRON_TRIGGER: "⏰",
  }[type];

  const competitionInfo = entry.competitionId
    ? ` [Competition ${entry.competitionId.toString()}: ${entry.competitionTitle ?? "Unknown"}]`
    : "";

  logger.info(
    `${emoji} [NotificationLog] ${type}${competitionInfo} | Trigger: ${trigger} | Instance: ${INSTANCE_ID}`,
  );

  // File log (non-blocking)
  void (async () => {
    try {
      await ensureLogDir();
      const logLine = formatLogEntry(entry) + "\n";
      await Bun.write(Bun.file(LOG_FILE), logLine);
    } catch (error) {
      logger.error("❌ Failed to write notification log:", error);
    }
  })();
}

/**
 * Log when a cron job fires
 */
export function logCronTrigger(jobName: string, details?: string): void {
  logNotification(
    "CRON_TRIGGER",
    `cron:${jobName}`,
    details ? { message: details } : {},
  );
}

logger.info(
  `📝 Notification logger initialized | Instance ID: ${INSTANCE_ID} | Log file: ${LOG_FILE}`,
);
