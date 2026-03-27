import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type Logger = {
  debug: (event: string, data?: Record<string, unknown>) => void;
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
  child: (component: string) => Logger;
}

export function createLogger(options: {
  level: LogLevel;
  sessionId: string;
  logFilePath: string;
  component?: string;
}): Logger {
  const minLevel = LEVEL_ORDER[options.level];

  const dir = path.dirname(options.logFilePath);
  Bun.spawnSync(["mkdir", "-p", dir]);

  // Open a file writer for efficient appending
  const writer = Bun.file(options.logFilePath).writer();

  function log(
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < minLevel) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      component: options.component ?? "root",
      sessionId: options.sessionId,
      event,
      ...data,
    };

    const line = JSON.stringify(entry) + "\n";
    void writer.write(line);
    void writer.flush();

    if (level === "error") {
      console.error(`[${level}] ${event}`, data ?? "");
    }
  }

  return {
    debug: (event, data) => { log("debug", event, data); },
    info: (event, data) => { log("info", event, data); },
    warn: (event, data) => { log("warn", event, data); },
    error: (event, data) => { log("error", event, data); },
    child(component: string): Logger {
      return createLogger({
        ...options,
        component,
      });
    },
  };
}
