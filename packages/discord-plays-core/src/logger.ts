import winston from "winston";

// Minimal structured-logger interface the core modules log through. Each game
// injects the logger built by `createGameLogger` below; this shape is the subset
// the shared code relies on and matches winston's leveled methods
// (`(message, ...meta)`), so a winston logger satisfies it directly.
export type Logger = {
  debug: (message: string, ...meta: unknown[]) => void;
  info: (message: string, ...meta: unknown[]) => void;
  warn: (message: string, ...meta: unknown[]) => void;
  error: (message: unknown, ...meta: unknown[]) => void;
};

/**
 * The process logger both game backends use.
 *
 * Stdout only. The bots run headless in Kubernetes, where logs are captured
 * from the container's stdout (kubectl logs / Loki). A File transport writing
 * `logs/application.json` is both pointless (ephemeral, lost on restart) and
 * fatal: the app's working directory is not writable by the runtime user
 * (uid 1000), so winston's File transport crashed at startup with EACCES trying
 * to `mkdir logs/`.
 */
export function createGameLogger(): winston.Logger {
  return winston.createLogger({
    level: "info",
    format: winston.format.combine(winston.format.json()),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
        ),
        handleExceptions: true,
        handleRejections: true,
      }),
    ],
  });
}

/** A Logger that discards everything, for tests that exercise logging paths. */
export const silentLogger: Logger = {
  debug: () => {
    /* silent */
  },
  info: () => {
    /* silent */
  },
  warn: () => {
    /* silent */
  },
  error: () => {
    /* silent */
  },
};
