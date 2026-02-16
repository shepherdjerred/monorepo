/**
 * Structured logging utility using tslog
 *
 * Features:
 * - INFO and above to STDOUT
 * - ALL logs (including DEBUG/TRACE) to file
 * - Automatic file name detection in log output
 * - Named loggers for each module
 *
 * Usage:
 * ```typescript
 * import { createLogger } from "./logger";
 * const logger = createLogger("module-name");
 * logger.info("Application started");
 * logger.debug("Debug details", { data });
 * logger.error("Error occurred", error);
 * ```
 */
import { Logger, type ILogObj, type ISettingsParam } from "tslog";
import { z } from "zod";
// Bun.write() does not support append mode (see https://github.com/oven-sh/bun/issues/10473)
// Bun implements node:fs for this use case, and recommends using it for file appending
// eslint-disable-next-line no-restricted-imports -- Bun.write() lacks append support, node:fs/promises is the official Bun-recommended approach for file appending
import { appendFile, mkdir } from "node:fs/promises";

/**
 * Log levels in tslog:
 * 0 = silly
 * 1 = trace
 * 2 = debug
 * 3 = info
 * 4 = warn
 * 5 = error
 * 6 = fatal
 */

const LOG_FILE_PATH = Bun.env["LOG_FILE_PATH"] ?? "./logs/app.log";
const LOG_LEVEL_STDOUT = Bun.env["LOG_LEVEL_STDOUT"] ?? "info";
const LOG_LEVEL_FILE = Bun.env["LOG_LEVEL_FILE"] ?? "debug";

// Detect if we're running in a TTY environment
// In non-TTY environments (CI, Docker, etc.), we disable pretty styling to avoid color code errors
// Note: process.stdout.isTTY can be undefined at runtime even though TS types say boolean
const IS_TTY = "isTTY" in process.stdout && process.stdout.isTTY;

// Map log level names to numbers
const LOG_LEVEL_MAP: Record<string, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

function getLogLevelNumber(level: string): number {
  return LOG_LEVEL_MAP[level.toLowerCase()] ?? 3; // Default to info
}

// Ensure log directory exists
async function ensureLogDirectory(): Promise<void> {
  const lastSlash = LOG_FILE_PATH.lastIndexOf("/");
  const logDir = lastSlash > 0 ? LOG_FILE_PATH.slice(0, lastSlash) : ".";
  if (logDir !== ".") {
    try {
      await mkdir(logDir, { recursive: true });
    } catch {
      // Directory might already exist, that's fine
    }
  }
}

// Initialize log directory (fire and forget)
void ensureLogDirectory();

/**
 * Parse log metadata using Zod for type safety
 */
const LogMetaSchema = z.object({
  logLevelName: z.string().optional(),
  logLevelId: z.number().optional(),
  name: z.string().optional(),
  path: z
    .object({
      filePathWithLine: z.string().optional(),
    })
    .optional(),
});

/**
 * File transport that writes all log levels to a file
 * Uses async appendFile in fire-and-forget mode
 */
function fileTransport(logObj: ILogObj): void {
  const timestamp = new Date().toISOString();
  const metaResult = LogMetaSchema.safeParse(logObj["_meta"]);
  const meta = metaResult.success ? metaResult.data : undefined;
  const level = (meta?.logLevelName ?? "INFO").toUpperCase();
  const name = meta?.name ?? "app";
  const filePath = meta?.path?.filePathWithLine ?? "";

  // Extract message and additional data
  const args = Object.entries(logObj)
    .filter(([key]) => !key.startsWith("_"))
    .map(([, value]) => value);

  const message = args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack ?? ""}`;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");

  const logLine = `${timestamp} [${level}] [${name}] ${filePath ? `(${filePath}) ` : ""}${message}\n`;

  // Fire and forget async append
  void (async () => {
    try {
      await appendFile(LOG_FILE_PATH, logLine);
    } catch {
      // Silently fail if we can't write to the log file
      // We don't want logging failures to crash the app
    }
  })();
}

/**
 * Base logger settings for all loggers
 * Uses pretty formatting with colors in TTY, plain text in non-TTY (CI, Docker)
 */
const baseSettings: ISettingsParam<ILogObj> = {
  // Use "pretty" in TTY for colored output, "pretty" without styling in non-TTY
  type: "pretty",
  minLevel: getLogLevelNumber(LOG_LEVEL_STDOUT),
  prettyLogTemplate:
    "{{dateIsoStr}} {{logLevelName}} [{{name}}] {{filePathWithLine}}\t",
  prettyLogTimeZone: "UTC",
  // Only enable styling in TTY environments to avoid ANSI color code errors in CI
  stylePrettyLogs: IS_TTY,
  // Only include styles when in TTY mode

  hideLogPositionForProduction: false,
  // Attach file transport for all logs
  attachedTransports: [
    (logObj: ILogObj) => {
      // File transport logs everything (level 0 = silly)
      const metaResult = LogMetaSchema.safeParse(logObj["_meta"]);
      const meta = metaResult.success ? metaResult.data : undefined;
      const logLevel = meta?.logLevelId ?? 3;
      const minFileLevel = getLogLevelNumber(LOG_LEVEL_FILE);
      if (logLevel >= minFileLevel) {
        fileTransport(logObj);
      }
    },
  ],
};

/**
 * Root logger instance
 */
const rootLogger = new Logger<ILogObj>(baseSettings);

/**
 * Create a named logger for a specific module
 *
 * @param name - The name of the module (e.g., "discord", "api", "database")
 * @returns A logger instance with the given name
 *
 * @example
 * ```typescript
 * const logger = createLogger("discord");
 * logger.info("Bot connected");
 * logger.debug("Processing message", { messageId });
 * logger.error("Failed to send message", error);
 * ```
 */
export function createLogger(name: string): Logger<ILogObj> {
  return rootLogger.getSubLogger({ name });
}

/**
 * Default logger for quick use
 * Prefer createLogger() with a module name for better log organization
 * @lintignore
 */
export const logger = rootLogger;

/**
 * Log levels for reference
 * @lintignore
 */
export const LogLevel = {
  SILLY: 0,
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
  FATAL: 6,
} as const;
