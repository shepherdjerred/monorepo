import { expect, test } from "vitest";
import {
  discover,
  parseAgent,
  restart,
  runningSessions,
  type Runtime,
  type Target,
} from "../bin/codex_theme_restart_core.ts";
import { resumeArguments } from "../bin/codex_theme_restart_launch.ts";
import { parseOptions } from "../bin/codex_theme_restart_options.ts";

const thread = "01a10355-2454-79f2-9a92-942bcf20a30d";
const otherThread = "01a10390-cb7a-7a90-86b2-25c8c08c9ea5";
function agent(status = "idle", conversation: string | null = thread) {
  return {
    agent: "codex",
    agent_status: status,
    pane_id: "w1:p2",
    terminal_id: "terminal-1",
    name: "my-codex",
    ...(conversation
      ? {
          agent_session: {
            agent: "codex",
            kind: "id",
            source: "herdr:codex",
            value: conversation,
          },
        }
      : {}),
  };
}
function processes(
  foreground = 20,
  argv = ["/opt/homebrew/bin/codex", "--no-daemon"],
) {
  return {
    shell_pid: 10,
    foreground_process_group_id: foreground,
    foreground_processes: [
      { pid: foreground, argv, cwd: "/worktrees/path with 'quotes'" },
    ],
  };
}

test("parses explicit session/pane targeting and rejects ambiguous scopes", () => {
  expect(
    parseOptions(["--dry-run", "--session", "test", "--pane", "w1:p2"]),
  ).toEqual({
    dryRun: true,
    onChange: false,
    worker: false,
    session: "test",
    pane: "w1:p2",
  });
  expect(() => parseOptions(["--pane", "w1:p2"])).toThrow("requires --session");
  expect(() => parseOptions(["--session"])).toThrow("requires a value");
  expect(() => parseOptions(["--on-change", "--session", "test"])).toThrow(
    "all local sessions",
  );
  expect(() => parseOptions(["--unknown"])).toThrow("Unknown option");
});

test("lists running local sessions without starting stopped ones", () => {
  expect(
    runningSessions({
      sessions: [
        { name: "default", running: true },
        { name: "stopped", running: false },
        { name: "other", running: true },
      ],
    }),
  ).toEqual(["default", "other"]);
  expect(() =>
    runningSessions({ sessions: [{ name: "bad", running: "true" }] }),
  ).toThrow("Invalid");
});

test("retains observed bypass flags, other launch policy and argument boundaries", () => {
  const args = resumeArguments(
    [
      "/opt/homebrew/bin/codex",
      "--no-daemon",
      "resume",
      otherThread,
      "--dangerously-bypass-approvals-and-sandbox",
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
    "dark",
  );
  expect(args).toEqual([
    "resume",
    thread,
    "--no-daemon",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "--profile",
    "with spaces",
    "--model",
    "custom-model",
    "--add-dir",
    "/other dir",
    "--config",
    "custom.text=\"a 'quoted' value\"",
    "-c",
    'tui.resume_cwd="session"',
    "-c",
    'tui.theme="catppuccin-mocha"',
  ]);
});

test("overrides a stale theme after retained options and selects the light palette", () => {
  expect(
    resumeArguments(
      ["codex", "-c", 'tui.theme="old"', "resume", "--last"],
      thread,
      "light",
    ),
  ).toEqual([
    "resume",
    thread,
    "-c",
    'tui.resume_cwd="session"',
    "-c",
    'tui.theme="catppuccin-latte"',
  ]);
  expect(() => resumeArguments(["not-codex"], thread, "light")).toThrow(
    "not Codex",
  );
  expect(() =>
    resumeArguments(["codex", "--unknown-option"], thread, "light"),
  ).toThrow("Unsupported");
  expect(() => resumeArguments(["codex", "-c"], thread, "light")).toThrow(
    "Missing",
  );
});

test("requires an authoritative current UUID rather than launch argv or another agent kind", () => {
  expect(parseAgent({ agent: "claude" })).toBeUndefined();
  expect(parseAgent(agent("idle", null))?.thread).toBeUndefined();
  expect(() => parseAgent(agent("idle", "malformed"))).toThrow("UUID");
  expect(() => parseAgent(agent("new-unrecognized-state"))).toThrow(
    "Unrecognized",
  );
});

type Scenario = {
  status?: string;
  resumedStatus?: string;
  changed?: boolean;
  unknown?: boolean;
  neverExits?: boolean;
  replacedProcess?: boolean;
  replacedShell?: boolean;
  noResumedIdentity?: boolean;
  wrongResumedThread?: boolean;
  promptFailure?: boolean;
  startupFailure?: boolean;
  bypass?: boolean;
  lostBypass?: boolean;
};
function fixture(scenario: Scenario = {}) {
  const calls: string[][] = [];
  let time = 0;
  let keys = 0;
  let started = false;
  let launchedArguments: readonly string[] = [];
  let reported = false;
  let afterDiscovery = false;
  const handlers: Record<string, () => unknown> = {
    "agent list": () => ({
      agents: [
        { agent: "claude" },
        agent(scenario.status, scenario.unknown ? null : thread),
      ],
    }),
    "pane process-info": () => {
      const exited = keys >= 2 && !scenario.neverExits;
      const info = processes(started ? 30 : exited ? 10 : 20);
      if (started)
        info.foreground_processes[0]?.argv.push(
          "resume",
          scenario.wrongResumedThread ? otherThread : thread,
        );
      if (started) {
        info.foreground_processes[0]?.argv.push(
          ...launchedArguments.filter(
            (argument) =>
              argument.startsWith("--dangerously-bypass-") &&
              !scenario.lostBypass,
          ),
        );
      } else if (scenario.bypass) {
        info.foreground_processes[0]?.argv.push(
          "--dangerously-bypass-approvals-and-sandbox",
        );
      }
      if (afterDiscovery && scenario.replacedProcess)
        info.foreground_process_group_id = 99;
      if (afterDiscovery && scenario.replacedShell) info.shell_pid = 99;
      return { process_info: info };
    },
    "pane get": () => {
      afterDiscovery = true;
      if (!started && keys >= 2 && !scenario.neverExits)
        return { pane: { agent_status: "unknown" } };
      const status = started
        ? (scenario.resumedStatus ?? "idle")
        : (scenario.status ?? "idle");
      const conversation = scenario.changed
        ? otherThread
        : !reported && started && scenario.noResumedIdentity
          ? null
          : thread;
      return { pane: agent(status, conversation) };
    },
    "agent send-keys": () => {
      keys++;
      return {};
    },
    "pane report-agent-session": () => {
      reported = true;
      return {};
    },
    "agent rename": () => ({}),
    "agent start": () => {
      if (scenario.startupFailure) throw new Error("shell_not_ready");
      started = true;
      return {};
    },
    "agent prompt": () => {
      if (scenario.promptFailure)
        throw new Error("Delivery acknowledgement uncertain");
      return {};
    },
  };
  const runtime: Runtime = {
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    async call(session, args) {
      calls.push([session, ...args]);
      if (args[0] === "agent" && args[1] === "start") launchedArguments = args;
      const handler = handlers[`${args[0] ?? ""} ${args[1] ?? ""}`];
      if (handler === undefined) throw new Error("Unexpected test command");
      return handler();
    },
  };
  async function execute() {
    const result = await discover(runtime, "test-session", "dark");
    const target = result.targets[0];
    if (!target) throw new Error("Expected an eligible fixture target");
    return restart(runtime, target);
  }
  return { calls, runtime, execute };
}

test("unknown conversations stay running even when argv contains a resume UUID", async () => {
  const { calls, runtime } = fixture({ unknown: true });
  const result = await discover(runtime, "test-session", "dark");
  expect(result.targets).toEqual([]);
  expect(result.outcomes).toEqual([
    {
      session: "test-session",
      pane: "w1:p2",
      status: "skipped",
      message: "No authoritative conversation ID; pane left running",
    },
  ]);
  expect(calls).toHaveLength(1);
});

test("uses shell-aware agent start, preserves the name/directory, and continues working panes once", async () => {
  const { calls, execute } = fixture({ status: "working" });
  expect(await execute()).toMatchObject({
    status: "restarted",
    message: "Same conversation restored; continuation submitted once",
  });
  const start = calls.find((call) => call[2] === "start");
  expect(start).toEqual([
    "test-session",
    "agent",
    "start",
    "my-codex",
    "--kind",
    "codex",
    "--pane",
    "w1:p2",
    "--timeout",
    "30000",
    "--",
    "resume",
    thread,
    "--no-daemon",
    "-c",
    'tui.resume_cwd="session"',
    "-c",
    'tui.theme="catppuccin-mocha"',
  ]);
  const prompts = calls.filter((call) => call[2] === "prompt");
  expect(prompts).toHaveLength(1);
  expect(prompts[0]?.[4]).toContain(
    "external actions whose outcome is uncertain",
  );
  expect(calls.filter((call) => call[2] === "send-keys")).toHaveLength(2);
  expect(
    calls.some((call) => call.includes("focus") || call.includes("close")),
  ).toBe(false);
});

test.each(["idle", "done", "blocked", "unknown"])(
  "does not prompt a previously %s pane",
  async (status) => {
    const { calls, execute } = fixture({ status });
    expect(await execute()).toMatchObject({ status: "restarted" });
    expect(calls.filter((call) => call[2] === "prompt")).toEqual([]);
  },
);

test("does not inject another prompt if the shared daemon is already continuing work", async () => {
  const { calls, execute } = fixture({
    status: "working",
    resumedStatus: "working",
  });
  expect(await execute()).toMatchObject({
    status: "restarted",
    message: "Existing turn is already working; no duplicate prompt sent",
  });
  expect(calls.filter((call) => call[2] === "prompt")).toEqual([]);
});

test.each([
  { changed: true, expected: "skipped" },
  { replacedProcess: true, expected: "failed" },
  { replacedShell: true, expected: "failed" },
])(
  "rechecks the target before sending keys: %j",
  async ({ expected, ...scenario }) => {
    const { calls, execute } = fixture(scenario);
    expect(await execute()).toMatchObject({ status: expected });
    expect(
      calls.filter((call) => call[2] === "send-keys" || call[2] === "start"),
    ).toEqual([]);
  },
);

test("bounds exit attempts without force-killing or writing commands into Codex", async () => {
  const { calls, execute } = fixture({ neverExits: true });
  expect(await execute()).toMatchObject({
    status: "failed",
    message: "Codex did not exit within 5 seconds; no force-kill attempted",
  });
  expect(calls.filter((call) => call[2] === "send-keys")).toHaveLength(3);
  expect(calls.filter((call) => call[2] === "start")).toEqual([]);
  expect(calls.findLast((call) => call[2] === "rename")).toEqual([
    "test-session",
    "agent",
    "rename",
    "w1:p2",
    "my-codex",
  ]);
});

test.each([
  { status: "working", resumedStatus: "blocked" },
  { status: "working", wrongResumedThread: true },
  { status: "working", startupFailure: true },
])(
  "does not continue a blocked or unidentified startup: %j",
  async (scenario) => {
    const { calls, execute } = fixture(scenario);
    expect(await execute()).toMatchObject({ status: "failed" });
    expect(calls.filter((call) => call[2] === "prompt")).toEqual([]);
  },
);

test("records the verified exact resume before Codex emits its first SessionStart", async () => {
  const { calls, execute } = fixture({ noResumedIdentity: true });
  expect(await execute()).toMatchObject({ status: "restarted" });
  expect(
    calls.filter((call) => call[2] === "report-agent-session"),
  ).toHaveLength(1);
  expect(calls.filter((call) => call[2] === "prompt")).toEqual([]);
});

test("does not retry a continuation after uncertain delivery", async () => {
  const { calls, execute } = fixture({
    status: "working",
    promptFailure: true,
  });
  expect(await execute()).toMatchObject({ status: "failed" });
  expect(calls.filter((call) => call[2] === "prompt")).toHaveLength(1);
});

test("passes observed bypass to the wrapper and verifies the replacement process", async () => {
  const { calls, execute } = fixture({ status: "working", bypass: true });
  expect(await execute()).toMatchObject({ status: "restarted" });
  const start = calls.find((call) => call[2] === "start");
  expect(start).toContain("--dangerously-bypass-approvals-and-sandbox");
  expect(calls.filter((call) => call[2] === "prompt")).toHaveLength(1);
});

test("does not continue if the replacement loses the observed bypass flag", async () => {
  const { calls, execute } = fixture({
    status: "working",
    bypass: true,
    lostBypass: true,
  });
  expect(await execute()).toMatchObject({
    status: "failed",
    message:
      "Wrapper did not preserve observed bypass flags; no continuation sent",
  });
  expect(calls.filter((call) => call[2] === "prompt")).toEqual([]);
});

test("reports a missing explicitly selected pane without touching other panes", async () => {
  const { calls, runtime } = fixture();
  const result = await discover(runtime, "test-session", "light", "missing");
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]).toMatchObject({
    pane: "missing",
    status: "skipped",
  });
  expect(calls).toHaveLength(1);
});

test("a closed pane is a failure without a blind retry", async () => {
  const target: Target = {
    session: "test-session",
    agent: {
      pane: "closed",
      terminal: "terminal-1",
      thread,
      sessionSource: "herdr:codex",
      status: "idle",
      name: undefined,
    },
    pid: 20,
    shell: 10,
    args: [],
    bypass: [],
  };
  let calls = 0;
  const runtime: Runtime = {
    now: Date.now,
    sleep: async () => {
      throw new Error("No polling expected for a closed pane");
    },
    call: async () => {
      calls++;
      throw new Error("pane_not_found");
    },
  };
  expect(await restart(runtime, target)).toMatchObject({
    status: "failed",
    message: "pane_not_found",
  });
  expect(calls).toBe(1);
});
