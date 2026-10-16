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
    probeIdentities: false,
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

test("requires an authoritative current UUID rather than launch argv or another agent kind", () => {
  expect(parseAgent({ agent: "claude" })).toBeUndefined();
  expect(parseAgent(agent("idle", null))?.thread).toBeUndefined();
  expect(() => parseAgent(agent("idle", "malformed"))).toThrow("UUID");
  expect(() => parseAgent(agent("new-unrecognized-state"))).toThrow(
    "Unrecognized",
  );
});

test("accepts an absent or null pane name while rejecting malformed names", () => {
  for (const name of [undefined, null]) {
    expect(parseAgent({ ...agent(), name })?.name).toBeUndefined();
  }
  expect(() => parseAgent({ ...agent(), name: 12 })).toThrow(
    "Expected a nonempty string",
  );
});

type Scenario = {
  nativeStatus?: boolean;
  nativeChanged?: boolean;
  staleHook?: boolean;
  draft?: boolean;
  staleStatus?: boolean;
  staticStatus?: boolean;
  lostSubmission?: boolean;
  unsaved?: boolean;
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
  lostStartAcknowledgement?: boolean;
  bypass?: boolean;
  lostBypass?: boolean;
  unnamed?: boolean;
  hiddenNameReservation?: boolean;
};
function fixture(scenario: Scenario = {}) {
  const calls: string[][] = [];
  let time = 0;
  let keys = 0;
  let started = false;
  let launchedArguments: readonly string[] = [];
  let reported = false;
  let afterDiscovery = false;
  let name: string | null = scenario.unnamed ? null : "my-codex";
  let reservedName = scenario.hiddenNameReservation ?? false;
  let statusQueries = 0;
  let statusStaged = false;
  let nativeThread = thread;
  let reportedConversation: string | undefined;
  const handlers: Record<string, (args: readonly string[]) => unknown> = {
    "agent list": () => ({
      agents: [
        { agent: "claude" },
        {
          ...agent(
            scenario.status,
            scenario.unknown ? null : scenario.staleHook ? otherThread : thread,
          ),
          name,
        },
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
          : (reportedConversation ??
            (scenario.staleHook ? otherThread : thread));
      return { pane: { ...agent(status, conversation), name } };
    },
    "agent send-keys": (args) => {
      if (args[3] === "enter") {
        statusStaged = scenario.lostSubmission ?? false;
        statusQueries++;
        if (scenario.nativeChanged && statusQueries > 1)
          nativeThread = otherThread;
        return {};
      }
      keys++;
      return {};
    },
    "pane report-agent-session": (args) => {
      reported = true;
      reportedConversation = args[args.indexOf("--agent-session-id") + 1];
      return {};
    },
    "agent rename": () => ({}),
    "pane read": () => {
      const cards = scenario.staleStatus
        ? ""
        : Array.from(
            { length: scenario.staticStatus ? 1 : statusQueries },
            () =>
              `/status\n\n  >_ OpenAI Codex (v0.162.1)\n  Session:             ${nativeThread}\n`,
          ).join("\n");
      return `${cards}\n› ${scenario.draft ? "unfinished user draft" : statusStaged ? "/status" : "Ask Codex to do anything"}\n\n  model · /worktree             Vim: Insert`;
    },
    "pane send-text": () => {
      statusStaged = true;
      return {};
    },
    "agent start": () => {
      if (scenario.startupFailure) throw new Error("shell_not_ready");
      started = true;
      if (scenario.lostStartAcknowledgement)
        throw new Error("agent_name_not_found");
      return {};
    },
    "agent prompt": () => {
      if (scenario.promptFailure)
        throw new Error("Delivery acknowledgement uncertain");
      return {};
    },
  };
  const runtime: Runtime = {
    appearanceConfigured: () => true,
    conversationSaved: () => !scenario.unsaved,
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    async call(session, args) {
      calls.push([session, ...args]);
      if (args[0] === "agent" && args[1] === "start") {
        if (reservedName) throw new Error("agent_name_taken");
        launchedArguments = args;
        if (args[2] === undefined) throw new Error("Missing start name");
        name = args[2];
      }
      if (args[0] === "agent" && args[1] === "rename") {
        if (args[3] === undefined) throw new Error("Missing rename argument");
        name = args[3] === "--clear" ? null : args[3];
        if (args[3] === "--clear") reservedName = false;
      }
      const handler = handlers[`${args[0] ?? ""} ${args[1] ?? ""}`];
      if (handler === undefined) throw new Error("Unexpected test command");
      return handler(args);
    },
  };
  async function execute() {
    const result = await discover(runtime, "test-session", "dark", {
      probe: scenario.nativeStatus ?? false,
    });
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

test.each(["idle", "working"])(
  "preserves an unnamed %s pane after verifying its replacement",
  async (status) => {
    const { calls, runtime, execute } = fixture({ status, unnamed: true });
    expect(await execute()).toMatchObject({ status: "restarted" });
    const start = calls.findIndex((call) => call[2] === "start");
    const clear = calls.findIndex(
      (call, index) => index > start && call[2] === "rename",
    );
    expect(calls[start]?.[3]).toMatch(/^theme-[a-f0-9]{12}$/);
    expect(clear).toBeGreaterThan(start);
    expect(
      calls.slice(start + 1, clear).some((call) => call[2] === "process-info"),
    ).toBe(true);
    expect(calls[clear]).toEqual([
      "test-session",
      "agent",
      "rename",
      "w1:p2",
      "--clear",
    ]);
    const prompt = calls.findIndex((call) => call[2] === "prompt");
    if (status === "working") expect(prompt).toBeGreaterThan(clear);
    else expect(prompt).toBe(-1);
    const rediscovered = await discover(runtime, "test-session", "dark");
    expect(rediscovered.targets[0]?.agent.name).toBeUndefined();
  },
);

test("does not rename an unverified replacement of an unnamed pane", async () => {
  const { calls, execute } = fixture({
    unnamed: true,
    wrongResumedThread: true,
  });
  expect(await execute()).toMatchObject({ status: "failed" });
  const start = calls.findIndex((call) => call[2] === "start");
  expect(calls.slice(start + 1).filter((call) => call[2] === "rename")).toEqual(
    [],
  );
});

test("clears hidden persisted name reservations before exiting an unnamed client", async () => {
  const { calls, execute } = fixture({
    unnamed: true,
    hiddenNameReservation: true,
  });
  expect(await execute()).toMatchObject({ status: "restarted" });
  const clear = calls.findIndex((call) => call[2] === "rename");
  const exit = calls.findIndex((call) => call[2] === "send-keys");
  expect(clear).toBeGreaterThan(-1);
  expect(clear).toBeLessThan(exit);
});

test("verifies an uncertain launch by pane without repeating the start command", async () => {
  const { calls, execute } = fixture({
    nativeStatus: true,
    lostStartAcknowledgement: true,
  });
  expect(await execute()).toMatchObject({
    status: "restarted",
    message: expect.stringContaining(
      "acknowledgement failed but pane verified",
    ),
  });
  expect(calls.filter((call) => call[2] === "start")).toHaveLength(1);
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
  const result = await discover(runtime, "test-session", "light", {
    pane: "missing",
  });
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
    nativeStatus: false,
    mode: "dark",
  };
  let calls = 0;
  const runtime: Runtime = {
    appearanceConfigured: () => true,
    conversationSaved: () => true,
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

test("a native UUID without saved history is never stopped", async () => {
  const { calls, runtime } = fixture({ unsaved: true });
  const result = await discover(runtime, "test-session", "dark", {
    probe: true,
  });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]?.message).toContain("no saved history");
  expect(
    calls.some((call) => call[4] === "ctrl+c" || call[2] === "start"),
  ).toBe(false);
});

test("native probing recovers missing hook identities and verifies the same resumed thread", async () => {
  const { calls, execute } = fixture({
    nativeStatus: true,
    unknown: true,
    status: "working",
  });
  expect(await execute()).toMatchObject({ status: "restarted" });
  expect(
    calls.filter((call) => call[2] === "send-text" && call[4] === "/status"),
  ).toHaveLength(3);
  expect(
    calls.filter((call) => call[2] === "prompt" && call[4] !== "/status"),
  ).toHaveLength(1);
});

test("fresh native identity replaces an incorrect hook UUID", async () => {
  const { calls, execute } = fixture({ nativeStatus: true, staleHook: true });
  expect(await execute()).toMatchObject({ status: "restarted" });
  const start = calls.find((call) => call[2] === "start");
  expect(start).toContain(thread);
  expect(start).not.toContain(otherThread);
});

test("a native conversation switch after discovery is detected before any exit keys", async () => {
  const { calls, execute } = fixture({
    nativeStatus: true,
    nativeChanged: true,
  });
  expect(await execute()).toMatchObject({
    status: "skipped",
    message: "Pane conversation changed before restart",
  });
  expect(
    calls.some((call) => call[4] === "ctrl+c" || call[2] === "start"),
  ).toBe(false);
});

test("native probing rejects drafts without typing or exiting", async () => {
  const { calls, runtime } = fixture({ draft: true });
  const result = await discover(runtime, "test-session", "dark", {
    probe: true,
  });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]?.message).toContain(
    "draft or dialog left untouched",
  );
  expect(
    calls.some((call) => call[2] === "prompt" || call[2] === "send-keys"),
  ).toBe(false);
});

test.each(["blocked", "unknown"])(
  "native probing leaves %s panes untouched",
  async (status) => {
    const { calls, runtime } = fixture({ status });
    const result = await discover(runtime, "test-session", "dark", {
      probe: true,
    });
    expect(result.targets).toEqual([]);
    expect(
      calls.some((call) => call[2] === "prompt" || call[2] === "send-keys"),
    ).toBe(false);
  },
);

test("native probe times out on missing status output without exiting or retrying its command", async () => {
  const { calls, runtime } = fixture({ staleStatus: true });
  const result = await discover(runtime, "test-session", "dark", {
    probe: true,
  });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]?.message).toContain(
    "Native /status did not complete",
  );
  expect(calls.filter((call) => call[2] === "send-text")).toHaveLength(1);
  expect(calls.some((call) => call[4] === "ctrl+c")).toBe(false);
});

test("identical rendered status cards remain usable after observing command staging and completion", async () => {
  const { execute } = fixture({ nativeStatus: true, staticStatus: true });
  expect(await execute()).toMatchObject({ status: "restarted" });
});

test("an old card is insufficient when the staged native command never completes", async () => {
  const { calls, runtime } = fixture({
    staticStatus: true,
    lostSubmission: true,
  });
  const result = await discover(runtime, "test-session", "dark", {
    probe: true,
  });
  expect(result.targets).toEqual([]);
  expect(result.outcomes[0]?.message).toContain("did not complete");
  expect(calls.some((call) => call[4] === "ctrl+c")).toBe(false);
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

test("a continuation is reserved before delivery and never repeated across views of one thread", async () => {
  const continued = new Set<string>([thread]);
  const { calls, runtime } = fixture({ status: "working" });
  const result = await discover(runtime, "test-session", "dark");
  const target = result.targets[0];
  if (target === undefined) throw new Error("Missing target");
  expect(await restart(runtime, target, continued)).toMatchObject({
    status: "restarted",
    message: "Same conversation restored; continuation already handled",
  });
  expect(calls.filter((call) => call[2] === "prompt")).toHaveLength(0);
});
