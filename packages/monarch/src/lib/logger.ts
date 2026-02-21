type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const NO_COLOR = Bun.env["NO_COLOR"] !== undefined;
const IS_TTY = process.stderr.isTTY;

const color = (code: number, text: string): string =>
  NO_COLOR ? text : `\u001B[${String(code)}m${text}\u001B[0m`;

const COLORS: Record<LogLevel, (text: string) => string> = {
  debug: (t) => color(90, t),
  info: (t) => color(36, t),
  warn: (t) => color(33, t),
  error: (t) => color(31, t),
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function write(level: LogLevel, message: string): void {
  if (!shouldLog(level)) return;
  const prefix = COLORS[level](`[${level.toUpperCase()}]`);
  process.stderr.write(`${prefix} ${message}\n`);
}

export const log = {
  debug(message: string): void {
    write("debug", message);
  },
  info(message: string): void {
    write("info", message);
  },
  warn(message: string): void {
    write("warn", message);
  },
  error(message: string): void {
    write("error", message);
  },
  progress(current: number, total: number, label: string): void {
    if (!shouldLog("info")) return;
    const text = COLORS.info(`[${String(current)}/${String(total)}]`) + ` ${label}`;
    if (IS_TTY) {
      process.stderr.write(`\r${text}`);
      if (current >= total) process.stderr.write("\n");
    } else {
      process.stderr.write(`${text}\n`);
    }
  },
};
