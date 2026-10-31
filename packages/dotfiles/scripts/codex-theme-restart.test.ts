import { expect, test } from "vitest";
import {
  discover,
  restart,
  type Target,
} from "../bin/codex_theme_restart_core.ts";
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
    state: "live",
    status: { app: "codex", state: "idle" },
    foreground: {
      pid: 20,
      argv: ["/opt/homebrew/bin/codex", "--no-daemon"],
      cwd: "/worktrees/path with 'quotes'",
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
    terminal: "t5",
  });
  expect(() => parseOptions(["--terminal"])).toThrow("requires a value");
  expect(() => parseOptions(["--on-change", "--terminal", "t5"])).toThrow(
    "all local terminals",
  );
  expect(() => parseOptions(["--session", "test"])).toThrow("Unknown option");
  expect(() => parseOptions(["--unknown"])).toThrow("Unknown option");
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
    foreground: { pid: 20, argv: ["/opt/homebrew/bin/codex", "--no-daemon"] },
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

test("drops stale UI overrides without adding flags that disable the shared daemon", () => {
  expect(
    resumeArguments(
      ["codex", "-c", 'tui.theme="old"', "resume", "--last"],
      thread,
    ),
  ).toEqual(["resume", thread]);
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
  nativeChanged?: boolean;
  draft?: boolean;
  staleStatus?: boolean;
  staticStatus?: boolean;
  lostSubmission?: boolean;
  unsaved?: boolean;
  status?: string;
  resumedStatus?: string;
  unreportedStart?: boolean;
  neverExits?: boolean;
  replacedProcess?: boolean;
  replacedShell?: boolean;
  wrongResumedThread?: boolean;
  resumedDifferent?: boolean;
  promptFailure?: boolean;
  startupFailure?: boolean;
  lostStartAcknowledgement?: boolean;
  bypass?: boolean;
  lostBypass?: boolean;
};

const isStatusKeys = (call: string[]) =>
  call[0] === "keys" && call.slice(2).join("") === "/status";
const isEnter = (call: string[]) =>
  call[0] === "keys" && call[2] === "enter" && call.length === 3;
const isCtrlC = (call: string[]) => call[0] === "keys" && call[2] === "ctrl+c";
const isLaunch = (call: string[]) =>
  call[0] === "send" && (call[2]?.startsWith("codex ") ?? false);
const isPrompt = (call: string[]) => call[0] === "send" && !isLaunch(call);

function fixture(scenario: Scenario = {}) {
  const calls: string[][] = [];
  let time = 0;
  let ctrlC = 0;
  let started = false;
  let startedGets = 0;
  let launchLine = "";
  let statusQueries = 0;
  let statusStaged = false;
  let nativeThread = thread;
  let afterDiscovery = false;
  const shell = 10;
  const foregroundPid = () => {
    if (started) return 30;
    if (ctrlC >= 2 && !scenario.neverExits) return shell;
    return afterDiscovery && scenario.replacedProcess ? 99 : 20;
  };
  const foregroundArgv = () => {
    if (started) {
      const flags = launchLine
        .split(" ")
        .filter((word) => word.startsWith("--dangerously-bypass-"));
      return [
        "/opt/homebrew/bin/codex",
        "resume",
        scenario.wrongResumedThread ? otherThread : thread,
        ...(scenario.lostBypass ? [] : flags),
      ];
    }
    if (foregroundPid() === shell) return ["/opt/homebrew/bin/fish", "-l"];
    return [
      "/opt/homebrew/bin/codex",
      "--no-daemon",
      ...(scenario.bypass ? [bypassFlag] : []),
    ];
  };
  const status = () => {
    if (!started && foregroundPid() === shell) return null;
    if (started) {
      return scenario.unreportedStart && startedGets++ < 4
        ? null
        : { app: "codex", state: scenario.resumedStatus ?? "idle" };
    }
    return scenario.status === "unknown"
      ? null
      : { app: "codex", state: scenario.status ?? "idle" };
  };
  const handlers: Record<string, (args: string[]) => string> = {
    ls: () =>
      JSON.stringify({
        terminals: [
          { address: "t1", agent: "claude-code", state: "live" },
          { address: "desktop/t2", agent: "codex", state: "live" },
          { address: "t5", agent: "codex", state: "live" },
        ],
      }),
    get: () =>
      JSON.stringify(
        terminal({
          pid: afterDiscovery && scenario.replacedShell ? 99 : shell,
          status: status(),
          foreground: {
            pid: foregroundPid(),
            argv: foregroundArgv(),
            cwd: "/worktrees",
          },
        }),
      ),
    keys: (args) => {
      if (isStatusKeys(args)) {
        statusStaged = true;
      } else if (isEnter(args)) {
        statusStaged = scenario.lostSubmission ?? false;
        statusQueries++;
        if (scenario.nativeChanged && statusQueries > 1)
          nativeThread = otherThread;
      } else if (isCtrlC(args)) {
        ctrlC++;
      }
      return "{}";
    },
    read: () => {
      const shown =
        started && scenario.resumedDifferent ? otherThread : nativeThread;
      const cards = scenario.staleStatus
        ? ""
        : Array.from(
            { length: scenario.staticStatus ? 1 : statusQueries },
            () =>
              `/status\n\n  >_ OpenAI Codex (v0.162.1)\n  Session:             ${shown}\n`,
          ).join("\n");
      const composer = scenario.draft
        ? "unfinished user draft"
        : statusStaged
          ? "/status"
          : "Ask Codex to do anything";
      return `${cards}\n› ${composer}\n\n  model · /worktree             Vim: Insert`;
    },
    send: (args) => {
      if (isLaunch(args)) {
        if (scenario.startupFailure) throw new Error("not_found");
        started = true;
        launchLine = args[2] ?? "";
        if (scenario.lostStartAcknowledgement) throw new Error("timeout");
        return "{}";
      }
      if (scenario.promptFailure)
        throw new Error("Delivery acknowledgement uncertain");
      return "{}";
    },
  };
  const runtime: Runtime = {
    appearanceConfigured: () => true,
    conversationSaved: () => !scenario.unsaved,
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    async hc(args) {
      calls.push([...args]);
      const handler = handlers[args[0] ?? ""];
      if (handler === undefined) throw new Error("Unexpected test command");
      return handler([...args]);
    },
  };
  async function execute() {
    const result = await discover(runtime, "dark", { probe: true });
    afterDiscovery = true;
    const target = result.targets[0];
    if (!target)
      throw new Error(
        `Expected an eligible fixture target: ${JSON.stringify(result.outcomes)}`,
      );
    return restart(runtime, target);
  }
  return { calls, runtime, execute };
}

test("a read-only preview lists eligible terminals without typing anything", async () => {
  const { calls, runtime } = fixture();
  const result = await discover(runtime, "dark");
  expect(result.outcomes).toEqual([]);
  expect(result.targets).toMatchObject([
    { terminal: "t5", status: "idle", thread: undefined },
  ]);
  expect(calls.map((call) => call[0])).toEqual(["ls", "get"]);
});

test("ignores remote and non-Codex terminals", async () => {
  const { calls, runtime } = fixture();
  await discover(runtime, "dark");
  expect(calls.filter((call) => call[0] === "get")).toEqual([
    ["get", "t5", "--json"],
  ]);
});

test("restarts through the terminal's shell and continues a working turn once", async () => {
  const { calls, execute } = fixture({ status: "working" });
  expect(await execute()).toMatchObject({
    terminal: "t5",
    status: "restarted",
    message: "Same conversation restored; continuation submitted once",
  });
  expect(calls.filter((call) => isLaunch(call))).toEqual([
    ["send", "t5", `codex resume ${thread} --no-daemon`],
  ]);
  const prompts = calls.filter((call) => isPrompt(call));
  expect(prompts).toHaveLength(1);
  expect(prompts[0]?.[2]).toContain(
    "external actions whose outcome is uncertain",
  );
  expect(calls.filter((call) => isCtrlC(call))).toHaveLength(2);
  expect(calls.some((call) => call[0] === "kill" || call[0] === "run")).toBe(
    false,
  );
});

test.each(["idle", "done"])(
  "does not prompt a previously %s terminal",
  async (status) => {
    const { calls, execute } = fixture({ status });
    expect(await execute()).toMatchObject({ status: "restarted" });
    expect(calls.filter((call) => isPrompt(call))).toEqual([]);
  },
);

test("waits for a freshly started client to report before continuing a working turn", async () => {
  const { calls, execute } = fixture({
    status: "working",
    unreportedStart: true,
  });
  expect(await execute()).toMatchObject({
    status: "restarted",
    message: "Same conversation restored; continuation submitted once",
  });
  expect(calls.filter((call) => isPrompt(call))).toHaveLength(1);
});

test("verifies an uncertain launch by process without repeating the send", async () => {
  const { calls, execute } = fixture({ lostStartAcknowledgement: true });
  expect(await execute()).toMatchObject({
    status: "restarted",
    message: expect.stringContaining(
      "acknowledgement failed but terminal verified",
    ),
  });
  expect(calls.filter((call) => isLaunch(call))).toHaveLength(1);
});

test("does not inject another prompt if the shared daemon is already continuing work", async () => {
  const { calls, execute } = fixture({
    status: "working",
    resumedStatus: "working",
  });
  expect(await execute()).toMatchObject({
    status: "restarted",
    message: "Existing turn is already working; no duplicate prompt sent",
  });
  expect(calls.filter((call) => isPrompt(call))).toEqual([]);
});

test.each(["blocked", "unknown", "error"])(
  "leaves a %s terminal untouched",
  async (status) => {
    const { calls, runtime } = fixture({ status });
    const result = await discover(runtime, "dark", { probe: true });
    expect(result.targets).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({
      terminal: "t5",
      status: "skipped",
    });
    expect(calls.some((call) => call[0] === "keys" || call[0] === "send")).toBe(
      false,
    );
  },
);

test.each([{ replacedProcess: true }, { replacedShell: true }])(
  "rechecks the process before sending keys: %j",
  async (scenario) => {
    const { calls, execute } = fixture(scenario);
    expect(await execute()).toMatchObject({
      status: "skipped",
      message: "Terminal process changed before restart",
    });
    expect(
      calls.some((call) => isCtrlC(call)) ||
        calls.some((call) => isLaunch(call)),
    ).toBe(false);
  },
);

test("a native conversation switch after discovery is detected before any exit keys", async () => {
  const { calls, execute } = fixture({ nativeChanged: true });
  expect(await execute()).toMatchObject({
    status: "skipped",
    message: "Terminal conversation changed before restart",
  });
  expect(
    calls.some((call) => isCtrlC(call)) || calls.some((call) => isLaunch(call)),
  ).toBe(false);
});

test("bounds exit attempts without force-killing or writing commands into Codex", async () => {
  const { calls, execute } = fixture({ neverExits: true });
  expect(await execute()).toMatchObject({
    status: "failed",
    message: "Codex did not exit within 5 seconds; no force-kill attempted",
  });
  expect(calls.filter((call) => isCtrlC(call))).toHaveLength(3);
  expect(calls.filter((call) => isLaunch(call))).toEqual([]);
  expect(calls.some((call) => call[0] === "kill")).toBe(false);
});

test.each([
  { status: "working", resumedStatus: "blocked" },
  { status: "working", wrongResumedThread: true },
  { status: "working", resumedDifferent: true },
  { status: "working", startupFailure: true },
])(
  "does not continue a blocked or unidentified startup: %j",
  async (scenario) => {
    const { calls, execute } = fixture(scenario);
    expect(await execute()).toMatchObject({ status: "failed" });
    expect(calls.filter((call) => isPrompt(call))).toEqual([]);
  },
);

test("does not retry a continuation after uncertain delivery", async () => {
  const { calls, execute } = fixture({
    status: "working",
    promptFailure: true,
  });
  expect(await execute()).toMatchObject({ status: "failed" });
  expect(calls.filter((call) => isPrompt(call))).toHaveLength(1);
});

test("passes observed bypass to the shell and verifies the replacement process", async () => {
  const { calls, execute } = fixture({ status: "working", bypass: true });
  expect(await execute()).toMatchObject({ status: "restarted" });
  expect(calls.find((call) => isLaunch(call))?.[2]).toContain(bypassFlag);
  expect(calls.filter((call) => isPrompt(call))).toHaveLength(1);
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
  expect(calls.filter((call) => isPrompt(call))).toEqual([]);
});

test("reports a missing explicitly selected terminal without touching others", async () => {
  const { calls, runtime } = fixture();
  const result = await discover(runtime, "light", { terminal: "t9" });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]).toMatchObject({
    terminal: "t9",
    status: "skipped",
  });
  expect(calls).toEqual([["ls", "--json"]]);
});

test("a closed terminal is a failure without a blind retry", async () => {
  const target: Target = {
    terminal: "closed",
    status: "idle",
    thread,
    shell: 10,
    pid: 20,
    argv: ["codex"],
    bypass: [],
    mode: "dark",
  };
  let calls = 0;
  const runtime: Runtime = {
    appearanceConfigured: () => true,
    conversationSaved: () => true,
    now: Date.now,
    sleep: async () => {
      throw new Error("No polling expected for a closed terminal");
    },
    hc: async () => {
      calls++;
      throw new Error("get failed: not_found (exit 3)");
    },
  };
  expect(await restart(runtime, target)).toMatchObject({
    status: "failed",
    message: "get failed: not_found (exit 3)",
  });
  expect(calls).toBe(1);
});

test("a native UUID without saved history is never stopped", async () => {
  const { calls, runtime } = fixture({ unsaved: true });
  const result = await discover(runtime, "dark", { probe: true });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]?.message).toContain("no saved history");
  expect(
    calls.some((call) => isCtrlC(call)) || calls.some((call) => isLaunch(call)),
  ).toBe(false);
});

test("native probing rejects drafts without typing or exiting", async () => {
  const { calls, runtime } = fixture({ draft: true });
  const result = await discover(runtime, "dark", { probe: true });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]?.message).toContain(
    "draft or dialog left untouched",
  );
  expect(calls.some((call) => call[0] === "keys" || call[0] === "send")).toBe(
    false,
  );
});

test("native probe times out on missing status output without exiting or retrying its command", async () => {
  const { calls, runtime } = fixture({ staleStatus: true });
  const result = await discover(runtime, "dark", { probe: true });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]?.message).toContain(
    "Native /status did not complete",
  );
  expect(calls.filter((call) => isStatusKeys(call))).toHaveLength(1);
  expect(calls.some((call) => isCtrlC(call))).toBe(false);
});

test("identical rendered status cards remain usable after observing command staging and completion", async () => {
  const { execute } = fixture({ staticStatus: true });
  expect(await execute()).toMatchObject({ status: "restarted" });
});

test("an old card is insufficient when the staged native command never completes", async () => {
  const { calls, runtime } = fixture({
    staticStatus: true,
    lostSubmission: true,
  });
  const result = await discover(runtime, "dark", { probe: true });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]?.message).toContain("did not complete");
  expect(calls.some((call) => isCtrlC(call))).toBe(false);
});

test("probe-only options are explicit and do not mix with a read-only preview or appearance event", () => {
  expect(parseOptions(["--probe-identities"]).probeIdentities).toBe(true);
  expect(() => parseOptions(["--dry-run", "--probe-identities"])).toThrow(
    "cannot be combined",
  );
  expect(() => parseOptions(["--on-change", "--probe-identities"])).toThrow(
    "cannot be combined",
  );
});

test("a continuation is reserved before delivery and never repeated across one thread", async () => {
  const continued = new Set<string>([thread]);
  const { calls, runtime } = fixture({ status: "working" });
  const result = await discover(runtime, "dark", { probe: true });
  const target = result.targets[0];
  if (target === undefined) throw new Error("Missing target");
  expect(await restart(runtime, target, continued)).toMatchObject({
    status: "restarted",
    message: "Same conversation restored; continuation already handled",
  });
  expect(calls.filter((call) => isPrompt(call))).toHaveLength(0);
});
