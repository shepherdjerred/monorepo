import winston from "winston";

// Log to stdout only. In the container the working directory is not writable by
// the runtime user (uid 1000), so the previous winston File transport crashed at
// construction with EACCES while trying to `mkdir logs/`. Nothing consumed
// logs/application.json — Kubernetes captures stdout — so a single Console
// transport is both the correct k8s pattern and removes the read-only-FS crash.
export const logger = winston.createLogger({
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
