import { expect, test } from "vitest";
import {
  discover,
  restart,
  waitForReadiness,
  type Target,
} from "../bin/codex_theme_restart_core.ts";
import { launchedTheme } from "../bin/codex_theme_restart_config.ts";
import {
  launchCommand,
  resumeArguments,
} from "../bin/codex_theme_restart_launch.ts";
import { parseOptions } from "../bin/codex_theme_restart_options.ts";
import {
  parseCodexTerminals,
  parseSnapshot,
  type Runtime,
} from "../bin/codex_theme_restart_terminal.ts";

const thread = "01a10355-2454-79f2-9a92-942bcf20a30d";
const otherThread = "01a10390-cb7a-7a90-86b2-25c8c08c9ea5";
const bypassFlag = "--dangerously-bypass-approvals-and-sandbox";

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    address: "t5",
    pid: 10,
    argv: ["fish"],
    created_ms: 10,
    turn: 4,
    state: "live",
    status: { app: "codex", state: "idle" },
    foreground: {
      pid: 20,
      argv: ["/opt/homebrew/bin/codex", "--no-daemon"],
      cwd: "/worktrees/path with spaces",
    },
    ...overrides,
  };
}

test("parses terminal targeting and rejects ambiguous scopes", () => {
  expect(parseOptions(["--dry-run", "--terminal", "t5"])).toEqual({
    dryRun: true,
    onChange: false,
    worker: false,
    probeIdentities: false,
    status: false,
    terminal: "t5",
  });
  expect(() => parseOptions(["--terminal"])).toThrow("requires a value");
  expect(() => parseOptions(["--on-change", "--terminal", "t5"])).toThrow(
    "all local terminals",
  );
  expect(() => parseOptions(["--session", "test"])).toThrow("Unknown option");
  expect(() => parseOptions(["--unknown"])).toThrow("Unknown option");
  expect(parseOptions(["--status"]).status).toBe(true);
  expect(() => parseOptions(["--status", "--terminal", "t5"])).toThrow(
    "read-only report",
  );
  expect(() => parseOptions(["--status", "--on-change"])).toThrow(
    "read-only report",
  );
});

test("lists only live local Codex terminals", () => {
  expect(
    parseCodexTerminals({
      terminals: [
        { address: "t1", agent: "claude-code", state: "live" },
        { address: "t5", agent: "codex", state: "live", status: "idle" },
        { address: "t6", agent: "codex", state: "finished" },
        { address: "desktop/t2", agent: "codex", state: "live" },
        { address: "t7", agent: "fish", state: "live" },
      ],
    }),
  ).toEqual(["t5"]);
  expect(() => parseCodexTerminals({ terminals: "none" })).toThrow("array");
});

test("reads status and the foreground process, treating a plain program as unreported", () => {
  expect(parseSnapshot(terminal())).toEqual({
    terminal: "t5",
    status: "idle",
    shell: 10,
    shellProgram: "fish",
    created: 10,
    turn: 4,
    foreground: {
      pid: 20,
      argv: ["/opt/homebrew/bin/codex", "--no-daemon"],
      cwd: "/worktrees/path with spaces",
    },
  });
  expect(parseSnapshot(terminal({ status: null })).status).toBe("unknown");
  expect(() =>
    parseSnapshot(terminal({ status: { app: "codex", state: "novel" } })),
  ).toThrow("Unrecognized");
  expect(() => parseSnapshot(terminal({ pid: 0 }))).toThrow("process ID");
});

test("retains observed bypass flags, other launch policy and argument boundaries", () => {
  const args = resumeArguments(
    [
      "/opt/homebrew/bin/codex",
      "--no-daemon",
      "resume",
      otherThread,
      bypassFlag,
      "--dangerously-bypass-hook-trust",
      "--profile",
      "with spaces",
      "--model=custom-model",
      "--add-dir",
      "/other dir",
      "--config",
      "custom.text=\"a 'quoted' value\"",
      "--cd",
      "/old cwd",
      "--worktree",
      "--image",
      "/old image",
      "original prompt that must not run again",
    ],
    thread,
  );
  expect(args).toEqual([
    "resume",
    thread,
    "--no-daemon",
    bypassFlag,
    "--dangerously-bypass-hook-trust",
    "--profile",
    "with spaces",
    "--model",
    "custom-model",
    "--add-dir",
    "/other dir",
    "--config",
    "custom.text=\"a 'quoted' value\"",
  ]);
});

test("drops every launch-time theme override so the wrapper's current theme wins", () => {
  expect(
    resumeArguments(
      ["codex", "-c", 'tui.theme="old"', "resume", "--last"],
      thread,
    ),
  ).toEqual(["resume", thread]);
  expect(
    resumeArguments(
      [
        "/opt/homebrew/bin/codex",
        "--no-daemon",
        "-c=tui.theme=catppuccin-latte",
        "--config",
        " tui.theme = 'catppuccin-mocha'",
        '--config=tui.theme="catppuccin-latte"',
        "-c",
        'tui.resume_cwd="session"',
        "-c",
        'tui.theme_extra="kept"',
        "-c=model_reasoning_effort=high",
        "resume",
        otherThread,
        "-c",
        'tui.theme="catppuccin-mocha"',
      ],
      thread,
    ),
  ).toEqual([
    "resume",
    thread,
    "--no-daemon",
    "-c",
    'tui.resume_cwd="session"',
    "-c",
    'tui.theme_extra="kept"',
    "-c",
    "model_reasoning_effort=high",
  ]);
  expect(
    launchCommand(
      ["codex", "--no-daemon", "-c", 'tui.theme="catppuccin-latte"'],
      thread,
    ),
  ).toBe(`codex resume ${thread} --no-daemon`);
  expect(() => resumeArguments(["not-codex"], thread)).toThrow("not Codex");
  expect(() => resumeArguments(["codex", "--unknown-option"], thread)).toThrow(
    "Unsupported",
  );
  expect(() => resumeArguments(["codex", "-c"], thread)).toThrow("Missing");
});

test("quotes the launch line for the interactive shell or refuses before stopping anything", () => {
  expect(
    launchCommand(
      ["/opt/homebrew/bin/codex", "--no-daemon", "--profile", "with spaces"],
      thread,
    ),
  ).toBe(`codex resume ${thread} --no-daemon --profile 'with spaces'`);
  expect(() => launchCommand(["codex", "--profile", "it's"], thread)).toThrow(
    "cannot be quoted",
  );
  expect(() =>
    launchCommand(["codex", "--profile", String.raw`a\b`], thread),
  ).toThrow("cannot be quoted");
});

type Scenario = {
  status?: "working" | "blocked";
  draft?: boolean;
  unavailableIdentity?: boolean;
  resumedIdentity?: string;
  startedTheme?: "latte" | "mocha";
  changesThread?: boolean;
  neverExits?: boolean;
  direct?: boolean;
  launchError?: boolean;
};

function fixture(scenario: Scenario = {}) {
  const calls: string[][] = [];
  let time = 0;
  let interrupted = false;
  let exited = false;
  let launched = false;
  let identities = 0;
  function currentTerminal(): string {
    if (launched)
      return JSON.stringify(
        terminal({
          foreground: {
            pid: 30,
            argv: [
              "codex",
              "resume",
              thread,
              "-c",
              'tui.theme="catppuccin-mocha"',
            ],
          },
        }),
      );
    if (exited)
      return JSON.stringify(
        terminal({
          status: null,
          foreground: { pid: 10, argv: ["fish"] },
        }),
      );
    return JSON.stringify(
      terminal({
        status: {
          app: "codex",
          state: interrupted ? "idle" : (scenario.status ?? "idle"),
        },
        foreground: {
          pid: scenario.direct ? 10 : 20,
          argv: [
            "codex",
            "--no-daemon",
            "-c",
            `tui.theme="catppuccin-${scenario.startedTheme ?? "latte"}"`,
          ],
          cwd: "/worktrees/path with spaces",
        },
      }),
    );
  }
  const runtime: Runtime = {
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    identity: async (snapshot) => {
      identities++;
      if (scenario.unavailableIdentity) return;
      if (snapshot.foreground.pid === 30)
        return scenario.resumedIdentity ?? thread;
      return scenario.changesThread && identities > 1 ? otherThread : thread;
    },
    hc: async (args) => {
      calls.push([...args]);
      switch (args[0]) {
        case "ls":
          return JSON.stringify({
            terminals: [
              { address: "t5", agent: "codex", state: "live" },
              { address: "desktop/t2", agent: "codex", state: "live" },
            ],
          });
        case "get":
          return currentTerminal();
        case "read":
          return scenario.draft
            ? "› private draft"
            : "› Ask Codex to do anything";
        case "interrupt":
          interrupted = true;
          return "{}";
        case "wait":
          interrupted = true;
          return "{}";
        case "keys":
          if (args[2] !== "ctrl+c") throw new Error("Unexpected key input");
          if (!scenario.neverExits) exited = true;
          return "{}";
        case "send":
          launched = true;
          if (scenario.launchError)
            throw new Error("Acknowledgement unavailable");
          return "{}";
        case undefined:
        default:
          throw new Error("Unexpected command");
      }
    },
  };
  return { runtime, calls };
}

async function targetOf(mock: ReturnType<typeof fixture>): Promise<Target> {
  const { targets } = await discover(mock.runtime, "dark");
  const target = targets[0];
  if (target === undefined) throw new Error("Expected a verified target");
  return target;
}

test("resumes the verified thread and exact working directory in the same shell", async () => {
  const mock = fixture();
  expect(await restart(mock.runtime, await targetOf(mock))).toEqual({
    terminal: "t5",
    status: "restarted",
    message: "Same conversation restored",
  });
  expect(
    mock.calls.filter((call) =>
      ["send", "keys", "interrupt"].includes(String(call[0])),
    ),
  ).toEqual([
    ["keys", "t5", "ctrl+c"],
    [
      "send",
      "t5",
      `codex resume ${thread} --no-daemon --cd '/worktrees/path with spaces'`,
    ],
  ]);
});

test.each([
  { status: "working" as const },
  { draft: true },
  { status: "blocked" as const },
])(
  "defers without input when the terminal is not safely idle %o",
  async (scenario) => {
    const mock = fixture(scenario);
    expect(await restart(mock.runtime, await targetOf(mock))).toMatchObject({
      status: "skipped",
      retry: true,
    });
    expect(
      mock.calls.some((call) =>
        ["send", "keys", "interrupt"].includes(String(call[0])),
      ),
    ).toBe(false);
  },
);

test("interrupts only the confirmed turn and submits no continuation prompt", async () => {
  const mock = fixture({ status: "working" });
  const target = await targetOf(mock);
  expect(
    await restart(mock.runtime, target, {
      interruptWorking: true,
      expectedTurn: 3,
    }),
  ).toMatchObject({ status: "skipped" });
  expect(mock.calls.some((call) => call[0] === "interrupt")).toBe(false);
  expect(
    await restart(mock.runtime, target, {
      interruptWorking: true,
      expectedTurn: 4,
    }),
  ).toMatchObject({ status: "restarted" });
  expect(mock.calls.filter((call) => call[0] === "interrupt")).toEqual([
    ["interrupt", "t5", "--timeout", "5"],
  ]);
  expect(mock.calls.filter((call) => call[0] === "send")).toHaveLength(1);
});

test("queued theme changes wait for the same session to become idle", async () => {
  const mock = fixture({ status: "working" });
  const target = await targetOf(mock);
  expect(
    await waitForReadiness(mock.runtime, target, () => Promise.resolve(false)),
  ).toBe(true);
  expect(mock.calls).toContainEqual(["wait", "t5", "--timeout", "15"]);
  expect(
    mock.calls.some((call) =>
      ["keys", "send", "interrupt"].includes(String(call[0])),
    ),
  ).toBe(false);
});

test("refuses stale identity and rejects a replacement reporting another thread", async () => {
  const stale = fixture({ changesThread: true });
  expect(await restart(stale.runtime, await targetOf(stale))).toMatchObject({
    status: "failed",
    message: "Terminal conversation changed before restart",
  });
  expect(
    stale.calls.some((call) => call[0] === "keys" || call[0] === "send"),
  ).toBe(false);
  const replacement = fixture({ resumedIdentity: otherThread });
  expect(
    await restart(replacement.runtime, await targetOf(replacement)),
  ).toMatchObject({
    status: "failed",
    message: "Restarted Codex reported a different conversation",
  });
});

test("bounds exit attempts without typing into the old Codex process", async () => {
  const mock = fixture({ neverExits: true });
  expect(await restart(mock.runtime, await targetOf(mock))).toMatchObject({
    status: "failed",
    message: "Codex did not exit within 5 seconds",
  });
  expect(mock.calls.filter((call) => call[0] === "keys")).toHaveLength(3);
  expect(mock.calls.some((call) => call[0] === "send")).toBe(false);
});

test("verifies an uncertain launch acknowledgement without launching twice", async () => {
  const mock = fixture({ launchError: true });
  expect(await restart(mock.runtime, await targetOf(mock))).toMatchObject({
    status: "restarted",
  });
  expect(mock.calls.filter((call) => call[0] === "send")).toHaveLength(1);
});

test("skips matched themes and refuses direct or unverified Codex processes", async () => {
  expect(
    await discover(fixture({ startedTheme: "mocha" }).runtime, "dark", {
      onChange: true,
    }),
  ).toEqual({ targets: [], outcomes: [] });
  for (const mock of [
    fixture({ direct: true }),
    fixture({ unavailableIdentity: true }),
  ]) {
    expect(await discover(mock.runtime, "dark")).toMatchObject({
      targets: [],
      outcomes: [{ terminal: "t5", status: "skipped" }],
    });
    expect(
      mock.calls.some((call) => call[0] === "keys" || call[0] === "send"),
    ).toBe(false);
  }
});
test("reads the launch theme from the last override in either option form", () => {
  expect(launchedTheme(["codex", "--no-daemon"])).toBeUndefined();
  expect(launchedTheme(["codex", "-c", 'tui.theme="catppuccin-mocha"'])).toBe(
    "catppuccin-mocha",
  );
  expect(
    launchedTheme([
      "codex",
      "--config=tui.theme='catppuccin-mocha'",
      "-c=tui.theme=catppuccin-latte",
    ]),
  ).toBe("catppuccin-latte");
  expect(launchedTheme(["codex", "-c", 'tui.theme_extra="x"'])).toBeUndefined();
  expect(
    launchedTheme(["codex", "--", "-c", 'tui.theme="catppuccin-mocha"']),
  ).toBeUndefined();
});
