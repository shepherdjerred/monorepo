import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendEvent,
  countOutcomes,
  parseEvent,
  readLastEvent,
  statusReport,
  summaryLine,
  type RunEvent,
} from "../bin/codex_theme_restart_events.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function event(overrides: Partial<RunEvent> = {}): RunEvent {
  const panes = overrides.panes ?? [
    {
      terminal: "t5",
      status: "restarted",
      message: "Same conversation restored",
    },
  ];
  return {
    ts: "2026-11-07T14:39:31.818Z",
    host: "karpathy",
    trigger: "on-change",
    terminal: null,
    previous: "light",
    mode: "dark",
    theme: "catppuccin-mocha",
    action: "restart",
    ok: true,
    error: null,
    ...overrides,
    panes,
    counts: countOutcomes(panes),
  };
}

test("round-trips an event and rejects a corrupt log entry", () => {
  const failed = event({
    ok: false,
    error: 'Executable not found in $PATH: "herdr"',
    panes: [],
    action: null,
    mode: null,
    theme: null,
    previous: null,
  });
  expect(parseEvent(JSON.stringify(failed))).toEqual(failed);
  expect(() => parseEvent("{not json")).toThrow("Invalid codex-theme-restart");
  expect(() =>
    parseEvent(JSON.stringify({ ...failed, trigger: "dry-run" })),
  ).toThrow("Invalid codex-theme-restart");
});

test("summaries name the outcome and the thrown error", () => {
  expect(summaryLine(event())).toBe(
    "on-change; ok; appearance light -> dark; theme catppuccin-mocha; 1 restarted, 0 eligible, 0 identified, 0 skipped, 0 failed",
  );
  expect(
    summaryLine(
      event({
        ok: false,
        error: "boom",
        action: null,
        mode: null,
        theme: null,
        panes: [],
      }),
    ),
  ).toBe("on-change; FAILED; appearance light -> unknown; error: boom");
  expect(
    summaryLine(event({ action: "unchanged", previous: "dark", panes: [] })),
  ).toBe(
    "on-change; ok; appearance dark -> dark; theme catppuccin-mocha; unchanged; no restarts",
  );
});

test("appends one line per run and keeps only the most recent entries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codex-theme-events-"));
  directories.push(directory);
  const file = path.join(directory, "events.jsonl");
  expect(await readLastEvent(file)).toBeUndefined();
  for (let index = 0; index < 7; index++)
    await appendEvent(file, event({ ts: `ts-${String(index)}` }), 5);
  const contents = await readFile(file, "utf8");
  const lines = contents.trim().split("\n");
  expect(lines).toHaveLength(5);
  expect(parseEvent(lines[0] ?? "").ts).toBe("ts-2");
  const last = await readLastEvent(file);
  expect(last?.ts).toBe("ts-6");
  await writeFile(file, `${lines.join("\n")}\ngarbage\n`);
  await expect(readLastEvent(file)).rejects.toThrow("Invalid");
});

const codex = "/opt/homebrew/bin/codex";

test("status passes when every local client runs the expected theme", () => {
  const report = statusReport({
    last: event(),
    recorded: "dark",
    current: "dark",
    configTheme: "catppuccin-latte",
    terminals: [
      {
        terminal: "t5",
        argv: [codex, "resume", "x", "-c", 'tui.theme="catppuccin-mocha"'],
      },
      { terminal: "t6", argv: ["/opt/homebrew/bin/fish", "-l"] },
    ],
  });
  expect(report.ok).toBe(true);
  expect(report.lines).toContain("  t5: catppuccin-mocha");
});

test("status fails on a stale client, recorded appearance or failed last run", () => {
  const stale = statusReport({
    last: event(),
    recorded: "dark",
    current: "dark",
    configTheme: "catppuccin-latte",
    terminals: [{ terminal: "t5", argv: [codex, "--no-daemon"] }],
  });
  expect(stale.ok).toBe(false);
  expect(stale.lines).toContain(
    "  t5: config default (catppuccin-latte) MISMATCH, expected catppuccin-mocha",
  );
  const lightDefault = statusReport({
    last: undefined,
    recorded: "light",
    current: "light",
    configTheme: "catppuccin-latte",
    terminals: [{ terminal: "t5", argv: [codex] }],
  });
  expect(lightDefault).toMatchObject({ ok: true });
  expect(lightDefault.lines[0]).toBe("Last run: none recorded");
  const unrecorded = statusReport({
    last: event(),
    recorded: "light",
    current: "dark",
    configTheme: undefined,
    terminals: [],
  });
  expect(unrecorded.ok).toBe(false);
  expect(unrecorded.lines).toContain(
    "Appearance: recorded light, current dark MISMATCH",
  );
  const failed = statusReport({
    last: event({
      ok: false,
      panes: [
        { terminal: "t5", status: "skipped", message: "draft left untouched" },
      ],
    }),
    recorded: "dark",
    current: "dark",
    configTheme: undefined,
    terminals: [{ terminal: "*", error: "ls failed: not_running (exit 1)" }],
  });
  expect(failed.ok).toBe(false);
  expect(failed.lines).toContain("  skipped t5: draft left untouched");
  expect(failed.lines).toContain(
    "  *: unknown (ls failed: not_running (exit 1))",
  );
});
