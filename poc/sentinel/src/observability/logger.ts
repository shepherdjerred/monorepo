import pino from "pino";

export const logger = pino({
  level: Bun.env["LOG_LEVEL"] ?? "info",
});
