import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import {
  launchedTheme,
  themeForAppearance,
} from "./codex_theme_restart_config.ts";
import type { Outcome } from "./codex_theme_restart_core.ts";
import type { Appearance, Options } from "./codex_theme_restart_options.ts";
import { array, object, string } from "./codex_theme_restart_terminal.ts";

export type Trigger = "on-change" | "manual" | "probe-identities";

/** What the run decided before touching terminals. */
export type Action = "unchanged" | "initialized" | "restart";

export type Counts = Record<Outcome["status"], number>;

/** One line of `events.jsonl`, written once per worker run. */
export type RunEvent = {
  ts: string;
  host: string;
  trigger: Trigger;
  terminal: string | null;
  previous: Appearance | null;
  mode: Appearance | null;
  theme: string | null;
  action: Action | null;
  ok: boolean;
  error: string | null;
  panes: Outcome[];
  counts: Counts;
};

const statuses: readonly Outcome["status"][] = [
  "restarted",
  "would-restart",
  "identified",
  "skipped",
  "failed",
];

export function triggerOf(options: Options): Trigger {
  if (options.probeIdentities) return "probe-identities";
  return options.onChange ? "on-change" : "manual";
}

export function countOutcomes(outcomes: readonly Outcome[]): Counts {
  const counts: Counts = {
    restarted: 0,
    "would-restart": 0,
    identified: 0,
    skipped: 0,
    failed: 0,
  };
  for (const outcome of outcomes) counts[outcome.status]++;
  return counts;
}

/** Skipped terminals also need inspection and an explicit manual retry. */
export function succeeded(outcomes: readonly Outcome[]): boolean {
  const counts = countOutcomes(outcomes);
  return counts.failed === 0 && counts.skipped === 0;
}

export function countsLine(counts: Counts): string {
  return `${String(counts.restarted)} restarted, ${String(counts["would-restart"])} eligible, ${String(counts.identified)} identified, ${String(counts.skipped)} skipped, ${String(counts.failed)} failed`;
}

/** A single-line summary for the console and the macOS unified log. */
export function summaryLine(event: RunEvent): string {
  const parts = [
    `${event.trigger}${event.terminal === null ? "" : ` ${event.terminal}`}`,
    event.ok ? "ok" : "FAILED",
    `appearance ${event.previous ?? "unrecorded"} -> ${event.mode ?? "unknown"}`,
  ];
  if (event.theme !== null) parts.push(`theme ${event.theme}`);
  if (event.action !== null && event.action !== "restart")
    parts.push(`${event.action}; no restarts`);
  else if (event.action === "restart") parts.push(countsLine(event.counts));
  if (event.error !== null) parts.push(`error: ${event.error}`);
  return parts.join("; ");
}

/** Lines describing each terminal that needs inspection. */
export function failureLines(event: RunEvent): string[] {
  return event.panes
    .filter((pane) => pane.status === "failed" || pane.status === "skipped")
    .map((pane) => `${pane.status} ${pane.terminal}: ${pane.message}`);
}

function appearance(value: unknown): Appearance | null {
  if (value === null || value === "light" || value === "dark") return value;
  throw new TypeError("Invalid appearance in event");
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

export function parseEvent(line: string): RunEvent {
  try {
    const event = object(JSON.parse(line));
    const trigger = event.get("trigger");
    if (
      trigger !== "on-change" &&
      trigger !== "manual" &&
      trigger !== "probe-identities"
    )
      throw new TypeError("Invalid trigger");
    const action = event.get("action");
    if (
      action !== null &&
      action !== "unchanged" &&
      action !== "initialized" &&
      action !== "restart"
    )
      throw new TypeError("Invalid action");
    const ok = event.get("ok");
    if (typeof ok !== "boolean") throw new TypeError("Invalid ok");
    const panes = array(event.get("panes")).map((entry): Outcome => {
      const pane = object(entry);
      const reported = pane.get("status");
      const status = statuses.find((known) => known === reported);
      if (status === undefined) throw new TypeError("Invalid pane status");
      return {
        terminal: string(pane.get("terminal")),
        status,
        message: string(pane.get("message")),
      };
    });
    return {
      ts: string(event.get("ts")),
      host: string(event.get("host")),
      trigger,
      terminal: nullableString(event.get("terminal")),
      previous: appearance(event.get("previous")),
      mode: appearance(event.get("mode")),
      theme: nullableString(event.get("theme")),
      action,
      ok,
      error: nullableString(event.get("error")),
      panes,
      counts: countOutcomes(panes),
    };
  } catch (error) {
    throw new Error("Invalid codex-theme-restart event log entry", {
      cause: error,
    });
  }
}

/** Append one event and keep only the most recent `keep` lines. */
export async function appendEvent(
  file: string,
  event: RunEvent,
  keep = 500,
): Promise<void> {
  await appendFile(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  const contents = await readFile(file, "utf8");
  const lines = contents.split("\n").filter(Boolean);
  if (lines.length <= keep) return;
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${lines.slice(-keep).join("\n")}\n`, {
    mode: 0o600,
  });
  await rename(temporary, file);
}

export async function readLastEvent(
  file: string,
): Promise<RunEvent | undefined> {
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
  const last = contents.split("\n").findLast(Boolean);
  return last === undefined ? undefined : parseEvent(last);
}

export type TerminalProcess =
  | { terminal: string; argv: readonly string[] }
  | { terminal: string; error: string };

export type StatusInput = {
  last: RunEvent | undefined;
  recorded: Appearance | undefined;
  current: Appearance;
  /** `tui.theme` from the Codex config file, used when no override was passed. */
  configTheme: string | undefined;
  terminals: readonly TerminalProcess[];
};

function terminalLine(
  process: TerminalProcess,
  {
    expected,
    configTheme,
  }: { expected: string; configTheme: string | undefined },
): { line: string; ok: boolean } {
  if ("error" in process)
    return {
      line: `${process.terminal}: unknown (${process.error})`,
      ok: false,
    };
  if (process.argv[0]?.split("/").at(-1) !== "codex")
    return {
      line: `${process.terminal}: Codex is not in the foreground; nothing to compare`,
      ok: true,
    };
  let launched: string | undefined;
  try {
    launched = launchedTheme(process.argv);
  } catch {
    return {
      line: `${process.terminal}: unreadable tui.theme override`,
      ok: false,
    };
  }
  const effective = launched ?? configTheme;
  const label = launched ?? `config default (${configTheme ?? "unset"})`;
  const ok = effective === expected;
  return {
    line: `${process.terminal}: ${label}${ok ? "" : ` MISMATCH, expected ${expected}`}`,
    ok,
  };
}

/** The read-only `--status` report; `ok` is false on any mismatch or a failed last run. */
export function statusReport(input: StatusInput): {
  lines: string[];
  ok: boolean;
} {
  const lines: string[] = [];
  let ok = true;
  const { last, recorded, current } = input;
  if (last === undefined) {
    lines.push("Last run: none recorded");
  } else {
    lines.push(`Last run: ${last.ts} on ${last.host}: ${summaryLine(last)}`);
    for (const failure of failureLines(last)) lines.push(`  ${failure}`);
    if (!last.ok) ok = false;
  }
  const appearanceOk = recorded === current;
  if (!appearanceOk) ok = false;
  lines.push(
    `Appearance: recorded ${recorded ?? "unrecorded"}, current ${current}${appearanceOk ? "" : " MISMATCH"}`,
  );
  const expected = themeForAppearance(current);
  lines.push(`Expected Codex theme: ${expected}`);
  if (input.terminals.length === 0) lines.push("Local Codex terminals: none");
  else lines.push("Local Codex terminals:");
  for (const process of input.terminals) {
    const result = terminalLine(process, {
      expected,
      configTheme: input.configTheme,
    });
    lines.push(`  ${result.line}`);
    if (!result.ok) ok = false;
  }
  return { lines, ok };
}
