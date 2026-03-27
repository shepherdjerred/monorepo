import { z } from "zod";
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

  const firstFile = logFiles[0];
  if (firstFile == null) {
    console.error("No log files found in ~/.recall/logs/");
    process.exit(1);
  }
  await (options.follow
    ? tailFollow(firstFile.name, options)
    : showRecent(logFiles, options));
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
      const content = await readFile(filePath, "utf8");
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
      const content = await readFile(filePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      const recent = lines.slice(-10);
      for (const line of recent) {
        if (matchesFilters(line, options.level)) {
          console.log(options.json ? line : formatLogLine(line));
        }
      }
    } catch {
      // ignore
    }
  }

  // Poll for new content, check for date rollover every 60s
  let currentFilePath = filePath;
  let rolloverCheck = Date.now();

  const interval = setInterval(() => {
    void (async () => {
      try {
        // Check for date rollover every 60s
        if (Date.now() - rolloverCheck > 60_000) {
          rolloverCheck = Date.now();
          const today = new Date().toISOString().slice(0, 10);
          const todayFile = path.join(LOGS_DIR, `recall-${today}.log`);
          if (todayFile !== currentFilePath) {
            const todayExists = await stat(todayFile).catch(() => null);
            if (todayExists != null) {
              currentFilePath = todayFile;
              offset = 0;
              console.error(`\n[logs] switched to ${todayFile}`);
            }
          }
        }

        const currentStat = await stat(currentFilePath).catch(() => null);
        if (currentStat == null || currentStat.size <= offset) return;

        const fd = Bun.file(currentFilePath);
        const content = await fd.text();
        const newContent = content.slice(offset);
        offset = currentStat.size;

        const newLines = newContent.trim().split("\n").filter(Boolean);
        for (const line of newLines) {
          if (matchesFilters(line, options.level)) {
            console.log(options.json ? line : formatLogLine(line));
          }
        }
      } catch {
        // ignore read errors
      }
    })();
  }, 500);

  // Keep alive
  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });

  await new Promise(() => {
    /* never resolves — keeps process alive */
  });
}

function matchesFilters(
  line: string,
  level: string | undefined,
  sinceTs?: string,
): boolean {
  if (level != null || sinceTs != null) {
    try {
      const entry = z.record(z.string(), z.unknown()).parse(JSON.parse(line));
      const entryLevel =
        typeof entry["level"] === "string" ? entry["level"] : undefined;
      const entryTs = typeof entry["ts"] === "string" ? entry["ts"] : undefined;
      if (level != null && entryLevel !== level) return false;
      if (sinceTs != null && entryTs != null && entryTs < sinceTs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function formatLogLine(line: string): string {
  try {
    const entry = z.record(z.string(), z.unknown()).parse(JSON.parse(line));
    const rawTs = entry["ts"];
    const rawLevel = entry["level"];
    const rawMod = entry["mod"];
    const rawMsg = entry["msg"];
    const ts = (typeof rawTs === "string" ? rawTs : "").slice(11, 19); // HH:MM:SS
    const level = (typeof rawLevel === "string" ? rawLevel : "")
      .toUpperCase()
      .padEnd(5);
    const mod = (typeof rawMod === "string" ? rawMod : "").padEnd(8);
    const msg = typeof rawMsg === "string" ? rawMsg : "";

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

  const amountStr = match[1];
  const unit = match[2];
  if (amountStr == null || unit == null) return undefined;
  const amount = Number.parseInt(amountStr, 10);
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
