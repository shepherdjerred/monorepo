import winston from "winston";

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.json()),
  transports: [
    new winston.transports.File({
      filename: "logs/application.json",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      handleExceptions: true,
      handleRejections: true,
      options: { flags: "w" },
    }),
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
