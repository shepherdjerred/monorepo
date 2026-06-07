import winston from "winston";

// Log to stdout only. This runs headless in Kubernetes where logs are captured
// from the container's stdout (kubectl logs / Loki); a File transport writing
// `logs/application.json` is both pointless (ephemeral, lost on restart) and
// fatal — the app's CWD is not writable by the runtime user, so winston's File
// transport crashes at startup trying to `mkdir logs/`.
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
