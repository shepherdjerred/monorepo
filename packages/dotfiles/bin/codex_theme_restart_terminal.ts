import type { Appearance } from "./codex_theme_restart_options.ts";

export function object(value: unknown): Map<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Expected a JSON object");
  return new Map<string, unknown>(Object.entries(value));
}

export function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError("Expected a nonempty string");
  return value;
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Expected a JSON array");
  return value;
}

function pid(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Expected a positive process ID");
  }
  return value;
}

export function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Invalid JSON response from hc");
  }
}

/** hc reports `idle`, `working`, `done`, `blocked` and `error`; a plain program reports none. */
const statuses = new Set([
  "idle",
  "done",
  "working",
  "blocked",
  "error",
  "unknown",
]);

export type Snapshot = {
  /** hc address such as `t7`. */
  terminal: string;
  status: string;
  /** The terminal's own program, the interactive shell Codex runs under. */
  shell: number;
  foreground: { pid: number; argv: string[] };
};

/** One `hc get <terminal> --json` response. */
export function parseSnapshot(value: unknown): Snapshot {
  const terminal = object(value);
  const reported = terminal.get("status");
  const status =
    reported === null || reported === undefined
      ? "unknown"
      : string(object(reported).get("state"));
  if (!statuses.has(status)) throw new Error("Unrecognized hc status");
  const foreground = object(terminal.get("foreground"));
  return {
    terminal: string(terminal.get("address")),
    status,
    shell: pid(terminal.get("pid")),
    foreground: {
      pid: pid(foreground.get("pid")),
      argv: array(foreground.get("argv")).map((argument) => string(argument)),
    },
  };
}

/** Addresses of live local Codex terminals from `hc ls --json`; remote machines are out of scope. */
export function parseCodexTerminals(value: unknown): string[] {
  return array(object(value).get("terminals")).flatMap((entry) => {
    const terminal = object(entry);
    if (terminal.get("agent") !== "codex" || terminal.get("state") !== "live")
      return [];
    const address = string(terminal.get("address"));
    return address.includes("/") ? [] : [address];
  });
}

export type Runtime = {
  /** Runs `hc` with the given arguments and returns its standard output. */
  hc: (args: readonly string[]) => Promise<string>;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  conversationSaved: (thread: string) => boolean;
  appearanceConfigured: (mode: Appearance) => boolean | Promise<boolean>;
};

export async function snapshotOf(
  runtime: Runtime,
  terminal: string,
): Promise<Snapshot> {
  return parseSnapshot(
    parseJson(await runtime.hc(["get", terminal, "--json"])),
  );
}
