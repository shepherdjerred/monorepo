import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Logger } from "./logger.ts";
import { LOGS_DIR } from "#lib/recall/config.ts";

export type LogViewOptions = {
  follow: boolean;
  level: string | undefined;
  since: string | undefined;
  json: boolean;
  limit: number;
};

export async function viewLogs(options: LogViewOptions): Promise<void> {
  const logger = new Logger();
  const logFiles = await logger.getLogFiles();

  if (logFiles.length === 0) {
    console.error("No log files found in ~/.recall/logs/");
    process.exit(1);
  }

  await (options.follow ? tailFollow(logFiles[0]!.name, options) : showRecent(logFiles, options));
}

async function showRecent(
  logFiles: { name: string; date: string }[],
  options: LogViewOptions,
): Promise<void> {
  const lines: string[] = [];
  const sinceTs = parseSince(options.since);

  // Read from newest files first until we have enough lines
  for (const file of logFiles) {
    const filePath = path.join(LOGS_DIR, file.name);
    try {
      const content = await readFile(filePath, "utf-8");
      const fileLines = content.trim().split("\n").filter(Boolean);

      for (const line of fileLines) {
        if (matchesFilters(line, options.level, sinceTs)) {
          lines.push(line);
        }
      }
    } catch {
      continue;
    }
  }

  // Show the last N lines
  const toShow = lines.slice(-options.limit);

  for (const line of toShow) {
    if (options.json) {
      console.log(line);
    } else {
      console.log(formatLogLine(line));
    }
  }

  if (toShow.length === 0) {
    console.log("No matching log entries.");
  }
}

async function tailFollow(
  latestFile: string,
  options: LogViewOptions,
): Promise<void> {
  const filePath = path.join(LOGS_DIR, latestFile);

  // Check if file exists
  const exists = await stat(filePath).catch(() => null);
  let offset = exists?.size ?? 0;

  console.error(`Tailing ${filePath} (Ctrl+C to stop)`);

  // Show last 10 lines first
  if (exists != null) {
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const recent = lines.slice(-10);
      for (const line of recent) {
        if (matchesFilters(line, options.level, undefined)) {
          console.log(options.json ? line : formatLogLine(line));
        }
      }
    } catch {
      // ignore
    }
  }

  // Poll for new content
  const interval = setInterval(async () => {
    try {
      const currentStat = await stat(filePath).catch(() => null);
      if (currentStat == null || currentStat.size <= offset) return;

      const fd = Bun.file(filePath);
      const content = await fd.text();
      const newContent = content.slice(offset);
      offset = currentStat.size;

      const newLines = newContent.trim().split("\n").filter(Boolean);
      for (const line of newLines) {
        if (matchesFilters(line, options.level, undefined)) {
          console.log(options.json ? line : formatLogLine(line));
        }
      }
    } catch {
      // ignore read errors
    }
  }, 500);

  // Keep alive
  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });

  await new Promise(() => {}); // never resolves
}

function matchesFilters(
  line: string,
  level: string | undefined,
  sinceTs: string | undefined,
): boolean {
  if (level != null || sinceTs != null) {
    try {
      const entry = JSON.parse(line) as { level?: string; ts?: string };
      if (level != null && entry.level !== level) return false;
      if (sinceTs != null && entry.ts != null && entry.ts < sinceTs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function formatLogLine(line: string): string {
  try {
    const entry = JSON.parse(line) as Record<string, unknown>;
    const ts = (entry["ts"] as string).slice(11, 19); // HH:MM:SS
    const level = (entry["level"] as string).toUpperCase().padEnd(5);
    const mod = (entry["mod"] as string ?? "").padEnd(8);
    const msg = entry["msg"] as string ?? "";

    // Gather extra fields
    const skip = new Set(["ts", "level", "mod", "msg"]);
    const extras = Object.entries(entry)
      .filter(([k]) => !skip.has(k))
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");

    const levelColor =
      entry["level"] === "error"
        ? "\u001B[31m"
        : entry["level"] === "warn"
          ? "\u001B[33m"
          : "\u001B[36m";
    const reset = "\u001B[0m";

    return `${ts} ${levelColor}${level}${reset} ${mod} ${msg} ${extras}`.trimEnd();
  } catch {
    return line;
  }
}

function parseSince(since: string | undefined): string | undefined {
  if (since == null) return undefined;

  const match = /^(\d+)([mhd])$/.exec(since);
  if (match == null) return undefined;

  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;
  const now = new Date();

  switch (unit) {
    case "m":
      now.setMinutes(now.getMinutes() - amount);
      break;
    case "h":
      now.setHours(now.getHours() - amount);
      break;
    case "d":
      now.setDate(now.getDate() - amount);
      break;
  }

  return now.toISOString();
}
