import { appendFile, readdir, unlink, stat } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { LOGS_DIR } from "#lib/recall/config.ts";

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  ts: string;
  level: LogLevel;
  mod: string;
  msg: string;
  [key: string]: unknown;
};

const RETENTION_DAYS = 7;

export class Logger {
  private currentDate = "";
  private logPath = "";

  constructor(private readonly logsDir: string = LOGS_DIR) {}

  async init(): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
    this.rotateIfNeeded();
    await this.purgeOldLogs();
  }

  private rotateIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.logPath = path.join(this.logsDir, `recall-${today}.log`);
      // Purge old logs on date change (not just on init)
      void this.purgeOldLogs();
    }
  }

  async log(
    level: LogLevel,
    mod: string,
    msg: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    this.rotateIfNeeded();

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      mod,
      msg,
      ...extra,
    };

    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.logPath, line, "utf8");
  }

  info(mod: string, msg: string, extra: Record<string, unknown> = {}): Promise<void> {
    return this.log("info", mod, msg, extra);
  }

  warn(mod: string, msg: string, extra: Record<string, unknown> = {}): Promise<void> {
    return this.log("warn", mod, msg, extra);
  }

  error(mod: string, msg: string, extra: Record<string, unknown> = {}): Promise<void> {
    return this.log("error", mod, msg, extra);
  }

  private async purgeOldLogs(): Promise<void> {
    try {
      const files = await readdir(this.logsDir);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      for (const file of files) {
        if (!file.startsWith("recall-") || !file.endsWith(".log")) continue;
        const dateStr = file.slice("recall-".length, -".log".length);
        if (dateStr < cutoffStr) {
          await unlink(path.join(this.logsDir, file));
        }
      }
    } catch {
      // ignore purge errors
    }
  }

  getCurrentLogPath(): string {
    this.rotateIfNeeded();
    return this.logPath;
  }

  async getLogFiles(): Promise<{ name: string; size: number; date: string }[]> {
    try {
      const files = await readdir(this.logsDir);
      const logFiles: { name: string; size: number; date: string }[] = [];

      for (const file of files) {
        if (!file.startsWith("recall-") || !file.endsWith(".log")) continue;
        const filePath = path.join(this.logsDir, file);
        const fileStat = await stat(filePath);
        const dateStr = file.slice("recall-".length, -".log".length);
        logFiles.push({
          name: file,
          size: fileStat.size,
          date: dateStr,
        });
      }

      return logFiles.toSorted((a, b) => b.date.localeCompare(a.date));
    } catch {
      return [];
    }
  }
}
