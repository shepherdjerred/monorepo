import path from "node:path";
import { expect, test } from "vitest";
import {
  bareTerminal,
  isCrossMachine,
  launch,
  normalizeGitRemoteUrl,
  normPath,
  parsePreparedTakeover,
  parseRequest,
  parseWorktreeList,
  qualifiedTerminal,
  sanitizeWorktreeSlug,
  shortTitle,
  takeOverSession,
  type ExecResult,
  type MachineEnv,
  type PreparedSummary,
  type Request,
  type Runtime,
  type SpaceInfo,
} from "../bin/herdr_takeover_core.ts";

const base: Request = {
  terminal: "t7",
  space: "sp1",
  tab: "tb2",
  tabIndex: 2,
  tabName: null,
  pane: "p4",
  splitTab: false,
  cwd: "/repo",
  provider: "codex",
  machine: null,
  targetMachine: null,
  spaceTabCount: 2,
  spaceName: null,
  targetRepoCandidates: [],
  agentArgs: [],
  safe: false,
  launcher: "brim",
  note: null,
  prepared: null,
};

const samplePrepared: PreparedSummary = {
  title: "Fix cross-provider handoff",
  cwd: "/repo/sub",
  handoffPath: "/tmp/handoff-123.md",
  prompt: "- Continue fixing cross-provider handoff from /tmp/handoff-123.md",
};

const ok: ExecResult = { code: 0, stdout: "", stderr: "" };
const okOut = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string, code = 1): ExecResult => ({
  code,
  stdout: "",
  stderr,
});

const headSha = "4090c313d3abcdef0123456789abcdef01234567";

function gitTable(
  table: Readonly<Record<string, ExecResult>>,
  args: readonly string[],
): ExecResult {
  const key = args.join(" ");
  for (const [pattern, res] of Object.entries(table)) {
    if (key === pattern || key.includes(pattern)) return res;
  }
  return fail(`unexpected git: ${key}`);
}

function baseRuntime(overrides: Partial<Runtime> = {}) {
  const calls: string[] = [];
  const brimCalls: {
    machine: string | null;
    cwd: string;
    args: string[];
  }[] = [];
  const gitCalls: {
    machine: string | null;
    cwd: string;
    args: string[];
  }[] = [];
  const writtenHandoffs: {
    machine: string | null;
    targetHome: string;
    windows: boolean;
    fileName: string;
    markdown: string;
  }[] = [];
  const newSpaces: Record<string, unknown>[] = [];
  const selectedSpaces: Record<string, unknown>[] = [];
  const closedSpaces: Record<string, unknown>[] = [];
  const newTabs: Record<string, unknown>[] = [];
  const moveTabs: Record<string, unknown>[] = [];
  const closeTabs: Record<string, unknown>[] = [];
  const splitPanes: Record<string, unknown>[] = [];
  const closePanes: Record<string, unknown>[] = [];
  const hcCalls: string[][] = [];

  const envs = new Map<string | null, MachineEnv>([
    [null, { home: "/Users/jerred", windows: false }],
    ["mac-mini", { home: "/Users/jerred", windows: false }],
    ["karpathy", { home: "/Users/jerred", windows: false }],
    ["desktop", { home: "C:/Users/Jerred", windows: true }],
    ["jerred-desktop", { home: "C:/Users/Jerred", windows: true }],
  ]);

  const runtime: Runtime = {
    brim(machine, cwd, args) {
      calls.push("prepare");
      brimCalls.push({ machine, cwd, args });
      return Promise.resolve(
        okOut(
          JSON.stringify({
            sourceProvider: "claude-code",
            sourceDisplayName: "Claude Code",
            historySource: "claude",
            historyId: 42,
            sourceId: "sess-1",
            title: samplePrepared.title,
            cwd: samplePrepared.cwd,
            gitBranch: "feat/takeover",
            rawTranscriptPath: "/tmp/raw.jsonl",
            handoffPath: samplePrepared.handoffPath,
            messageCount: 18,
            prompt: samplePrepared.prompt,
            terminal: { address: "t7", space: "sp1", tab: "tb2" },
          }),
        ),
      );
    },
    git(machine, cwd, args) {
      gitCalls.push({ machine, cwd, args });
      return Promise.resolve(fail("not configured", 128));
    },
    machineEnv(machine) {
      return Promise.resolve(
        envs.get(machine) ?? { home: "/Users/jerred", windows: false },
      );
    },
    dirExists() {
      return Promise.resolve(false);
    },
    readHandoff(_machine, filePath) {
      calls.push("readHandoff");
      return Promise.resolve(`# Handoff from ${filePath}\n`);
    },
    writeTargetHandoff(machine, env, fileName, markdown) {
      calls.push("writeTargetHandoff");
      writtenHandoffs.push({
        machine,
        targetHome: env.home,
        windows: env.windows,
        fileName,
        markdown,
      });
      return Promise.resolve(
        `${normPath(env.home)}/.toolkit/takeovers/${fileName}`,
      );
    },
    writeFallbackHandoff(_machine, terminal, _markdown) {
      calls.push("writeFallback");
      return Promise.resolve(`/state/handoffs/${terminal}.md`);
    },
    listSpaces(): Promise<readonly SpaceInfo[]> {
      calls.push("spaces.ls");
      return Promise.resolve([]);
    },
    newSpace(args) {
      calls.push("space.new");
      newSpaces.push(args);
      return Promise.resolve({
        space: "sp-new",
        tab: "tb-new",
        terminal: "t9",
      });
    },
    selectSpace(args) {
      calls.push("space.select");
      selectedSpaces.push(args);
      return Promise.resolve();
    },
    closeSpace(args) {
      calls.push("space.close");
      closedSpaces.push(args);
      return Promise.resolve();
    },
    newTab(args) {
      calls.push("tab.new");
      newTabs.push(args);
      return Promise.resolve({ tab: "tb9", terminal: "t9" });
    },
    moveTab(args) {
      calls.push("tab.move");
      moveTabs.push(args);
      return Promise.resolve();
    },
    closeTab(args) {
      calls.push("tab.close");
      closeTabs.push(args);
      return Promise.resolve();
    },
    splitPane(args) {
      calls.push("pane.split");
      splitPanes.push(args);
      return Promise.resolve("t9");
    },
    closePane(args) {
      calls.push("pane.close");
      closePanes.push(args);
      return Promise.resolve();
    },
    hc(args) {
      calls.push(`hc:${args[0] ?? ""}`);
      hcCalls.push(args);
      if (args[0] === "get")
        return Promise.resolve(
          okOut(JSON.stringify({ status: { state: "idle" } })),
        );
      return args[0] === "read"
        ? Promise.resolve(
            okOut("Error: 5-hour quota exhausted\nLast edited src/main.ts\n"),
          )
        : Promise.resolve(ok);
    },
    sleep: () => Promise.resolve(),
    ...overrides,
  };

  return {
    runtime,
    calls,
    brimCalls,
    gitCalls,
    writtenHandoffs,
    newSpaces,
    selectedSpaces,
    closedSpaces,
    newTabs,
    moveTabs,
    closeTabs,
    splitPanes,
    closePanes,
    hcCalls,
  };
}

test("requests are validated strictly and remain backward-compatible when cross-machine keys are omitted", () => {
  const legacyJson = JSON.stringify({
    terminal: "karpathy/t7",
    space: "karpathy/sp1",
    tab: "karpathy/tb2",
    tabIndex: 2,
    tabName: null,
    pane: "karpathy/p4",
    splitTab: false,
    cwd: "/repo",
    provider: "codex",
    machine: "karpathy",
    agentArgs: [],
    safe: false,
    launcher: "brim",
    note: null,
    prepared: null,
  });
  const parsedLegacy = parseRequest(legacyJson);
  expect(parsedLegacy.targetMachine).toBe("karpathy");
  expect(parsedLegacy.spaceTabCount).toBe(2);
  expect(parsedLegacy.spaceName).toBeNull();
  expect(parsedLegacy.targetRepoCandidates).toEqual([]);
  expect(isCrossMachine(parsedLegacy)).toBe(false);

  const toLocal = parseRequest(
    JSON.stringify({
      ...JSON.parse(legacyJson),
      targetMachine: null,
      spaceTabCount: 1,
      spaceName: "monorepo",
      targetRepoCandidates: ["/Users/jerred/git/monorepo"],
    }),
  );
  expect(toLocal.machine).toBe("karpathy");
  expect(toLocal.targetMachine).toBeNull();
  expect(toLocal.spaceTabCount).toBe(1);
  expect(toLocal.spaceName).toBe("monorepo");
  expect(toLocal.targetRepoCandidates).toEqual(["/Users/jerred/git/monorepo"]);
  expect(isCrossMachine(toLocal)).toBe(true);

  expect(
    parseRequest(
      JSON.stringify({
        ...base,
        tabName: "Custom Tab",
        note: "  focus on unit tests  ",
        prepared: samplePrepared,
      }),
    ),
  ).toEqual({
    ...base,
    tabName: "Custom Tab",
    note: "focus on unit tests",
    prepared: samplePrepared,
  });

  expect(() => parseRequest("[]")).toThrow("JSON object");
  expect(() => parseRequest(JSON.stringify({ ...base, terminal: "" }))).toThrow(
    "terminal",
  );
  expect(() => parseRequest(JSON.stringify({ ...base, tabIndex: 0 }))).toThrow(
    "tabIndex",
  );
  expect(() =>
    parseRequest(JSON.stringify({ ...base, spaceTabCount: 0 })),
  ).toThrow("spaceTabCount");
  expect(() =>
    parseRequest(JSON.stringify({ ...base, targetMachine: "" })),
  ).toThrow("targetMachine");
  expect(() =>
    parseRequest(JSON.stringify({ ...base, spaceName: "   " })),
  ).toThrow("spaceName");
  expect(() =>
    parseRequest(JSON.stringify({ ...base, targetRepoCandidates: [42] })),
  ).toThrow("targetRepoCandidates");
  expect(() =>
    parseRequest(JSON.stringify({ ...base, splitTab: "no" })),
  ).toThrow("splitTab");
  expect(() =>
    parseRequest(JSON.stringify({ ...base, agentArgs: [1] })),
  ).toThrow("agentArgs");
  expect(() => parseRequest(JSON.stringify({ ...base, safe: 1 }))).toThrow(
    "safe",
  );
  expect(() =>
    parseRequest(JSON.stringify({ ...base, launcher: "fish" })),
  ).toThrow("launcher");
  expect(() =>
    parseRequest(
      JSON.stringify({
        ...base,
        prepared: { ...samplePrepared, prompt: "   " },
      }),
    ),
  ).toThrow("prepared.prompt");
});

test("git remote normalization, worktree porcelain parsing, and slug sanitization", () => {
  expect(
    normalizeGitRemoteUrl("git@github.com:ShepherdJerred/monorepo.git"),
  ).toBe("github.com/shepherdjerred/monorepo");
  expect(
    normalizeGitRemoteUrl(
      "ssh://git@github.com:22/ShepherdJerred/monorepo.git",
    ),
  ).toBe("github.com/shepherdjerred/monorepo");
  expect(
    normalizeGitRemoteUrl("https://github.com/ShepherdJerred/monorepo.git"),
  ).toBe("github.com/shepherdjerred/monorepo");
  expect(
    normalizeGitRemoteUrl("https://token@github.com/ShepherdJerred/monorepo/"),
  ).toBe("github.com/shepherdjerred/monorepo");

  expect(sanitizeWorktreeSlug("feat/cross-machine takeover")).toBe(
    "feat-cross-machine-takeover",
  );
  expect(normPath(String.raw`C:\Users\Jerred\git\monorepo` + "\\")).toBe(
    "C:/Users/Jerred/git/monorepo",
  );
  expect(normPath("/")).toBe("/");

  expect(
    parseWorktreeList(
      [
        "worktree /Users/jerred/git/monorepo",
        `HEAD ${headSha}`,
        "branch refs/heads/main",
        "",
        "worktree /Users/jerred/.herdr/worktrees/monorepo/feat-x",
        "HEAD 1111111111111111111111111111111111111111",
        "detached",
        "",
      ].join("\n"),
    ),
  ).toEqual([
    {
      path: "/Users/jerred/git/monorepo",
      head: headSha,
      branch: "main",
    },
    {
      path: "/Users/jerred/.herdr/worktrees/monorepo/feat-x",
      head: "1111111111111111111111111111111111111111",
      branch: null,
    },
  ]);
});

test("shortTitle compacts multiline and overly long titles", () => {
  expect(shortTitle("  \n  Fix   auth   flow \n details")).toBe(
    "Fix auth flow",
  );
  expect(shortTitle("   ")).toBe("Takeover");
  const long = "A".repeat(60);
  expect(shortTitle(long)).toBe(`${"A".repeat(47)}…`);
});

test("launch builds tab.new/space.new task vs -i vs typed, and only inlines prompt for same-machine pane.split", () => {
  expect(launch(base, samplePrepared)).toEqual({
    argv: ["brim", "--provider", "codex", "--", "--"],
    task: samplePrepared.prompt,
    typed: false,
    tabTitle: "Fix cross-provider handoff",
  });

  expect(launch({ ...base, splitTab: true }, samplePrepared)).toEqual({
    argv: ["brim", "--provider", "codex", "--", "--", samplePrepared.prompt],
    task: null,
    typed: false,
    tabTitle: "Fix cross-provider handoff",
  });

  expect(
    launch(
      { ...base, splitTab: true, machine: "karpathy", targetMachine: null },
      samplePrepared,
    ),
  ).toEqual({
    argv: ["brim", "--provider", "codex", "--", "--"],
    task: samplePrepared.prompt,
    typed: false,
    tabTitle: "Fix cross-provider handoff",
  });

  expect(
    launch(
      {
        ...base,
        provider: "claude-code",
        tabName: "Auth Refactor",
        agentArgs: ["--permission-mode", "plan"],
        safe: true,
      },
      samplePrepared,
    ),
  ).toEqual({
    argv: [
      "env",
      "AGENT_SAFE=1",
      "brim",
      "--provider",
      "claude-code",
      "--",
      "--permission-mode",
      "plan",
      "--name",
      "Auth Refactor",
      "--",
    ],
    task: samplePrepared.prompt,
    typed: false,
    tabTitle: "Auth Refactor",
  });

  expect(launch({ ...base, provider: "antigravity" }, samplePrepared)).toEqual({
    argv: [
      "brim",
      "--provider",
      "antigravity",
      "--",
      "-i",
      samplePrepared.prompt,
    ],
    task: null,
    typed: false,
    tabTitle: "Fix cross-provider handoff",
  });

  expect(launch({ ...base, provider: "kimi" }, samplePrepared)).toEqual({
    argv: ["brim", "--provider", "kimi", "--"],
    task: null,
    typed: true,
    tabTitle: "Fix cross-provider handoff",
  });

  expect(
    launch(
      { ...base, launcher: "profile", safe: true, splitTab: true },
      samplePrepared,
    ),
  ).toEqual({
    argv: ["agent-safe", "codex", "--", samplePrepared.prompt],
    task: null,
    typed: false,
    tabTitle: "Fix cross-provider handoff",
  });
  expect(
    launch(
      {
        ...base,
        launcher: "profile",
        safe: true,
        splitTab: true,
        machine: null,
        targetMachine: "jerred-desktop",
      },
      samplePrepared,
    ),
  ).toEqual({
    argv: ["agent-safe", "codex", "--"],
    task: samplePrepared.prompt,
    typed: false,
    tabTitle: "Fix cross-provider handoff",
  });
});

test("single-pane tab replacement runs prepare -> tab.new -> tab.move -> tab.close", async () => {
  const fake = baseRuntime();
  const steps: string[] = [];
  const outcome = await takeOverSession(
    { ...base, note: "Run bun test first" },
    fake.runtime,
    (u) => {
      steps.push(u.step);
    },
  );

  expect(fake.calls).toEqual(["prepare", "tab.new", "tab.move", "tab.close"]);
  expect(steps).toEqual(["preparing", "opening", "moving", "closing"]);
  expect(fake.brimCalls).toEqual([
    {
      machine: null,
      cwd: "/repo",
      args: [
        "takeover",
        "--prepare",
        "--json",
        "--terminal",
        "t7",
        "--note",
        "Run bun test first",
      ],
    },
  ]);
  expect(fake.newTabs).toEqual([
    {
      space: "sp1",
      folder: "/repo/sub",
      name: "Fix cross-provider handoff",
      argv: ["brim", "--provider", "codex", "--", "--"],
      task: samplePrepared.prompt,
    },
  ]);
  expect(fake.moveTabs).toEqual([{ id: "tb9", index: 2 }]);
  expect(fake.closeTabs).toEqual([{ id: "tb2", confirmed: true }]);
  expect(outcome).toEqual({
    title: "Fix cross-provider handoff",
    cwd: "/repo/sub",
    handoffPath: "/tmp/handoff-123.md",
    terminal: "t9",
    tab: "tb9",
    space: "sp1",
    targetMachine: null,
    migrated: false,
    splitTab: false,
    messageSent: "argument",
  });
});

test("failure safety: if prepare or opening fails, user's tab or pane is never closed", async () => {
  const failedPrepare = baseRuntime({
    brim: () =>
      Promise.resolve(fail("brim: no transcript found for terminal t7\n")),
  });

  await expect(takeOverSession(base, failedPrepare.runtime)).rejects.toThrow(
    "no transcript found",
  );
  expect(failedPrepare.newTabs).toEqual([]);
  expect(failedPrepare.closeTabs).toEqual([]);
  expect(failedPrepare.splitPanes).toEqual([]);
  expect(failedPrepare.closePanes).toEqual([]);

  const failedOpen = baseRuntime({
    newTab: () => Promise.reject(new Error("Herdr layout unavailable")),
  });
  await expect(takeOverSession(base, failedOpen.runtime)).rejects.toThrow(
    "Herdr layout unavailable",
  );
  expect(failedOpen.closeTabs).toEqual([]);
});

test("split-pane tab replacement runs prepare -> pane.split -> pane.close without closing tab", async () => {
  const fake = baseRuntime();
  const outcome = await takeOverSession(
    { ...base, splitTab: true, pane: "p-agent" },
    fake.runtime,
  );

  expect(fake.calls).toEqual(["prepare", "pane.split", "pane.close"]);
  expect(fake.newTabs).toEqual([]);
  expect(fake.closeTabs).toEqual([]);
  expect(fake.splitPanes).toEqual([
    {
      direction: "right",
      pane: "p-agent",
      argv: ["brim", "--provider", "codex", "--", "--", samplePrepared.prompt],
    },
  ]);
  expect(fake.closePanes).toEqual([{ pane: "p-agent" }]);
  expect(outcome.splitTab).toBe(true);
  expect(outcome.migrated).toBe(false);
});

test("remote machine prefix handling strips machine for brim --terminal and qualifies hc send for Kimi", async () => {
  expect(bareTerminal("karpathy/t7", "karpathy")).toBe("t7");
  expect(bareTerminal("t7", null)).toBe("t7");
  expect(qualifiedTerminal("t9", "karpathy")).toBe("karpathy/t9");
  expect(qualifiedTerminal("karpathy/t9", "karpathy")).toBe("karpathy/t9");
  expect(qualifiedTerminal("t9", null)).toBe("t9");

  let gets = 0;
  const fake = baseRuntime({
    hc(args) {
      fake.calls.push(`hc:${args[0] ?? ""}`);
      fake.hcCalls.push(args);
      if (args[0] === "get") {
        gets++;
        const state = gets < 2 ? "blocked" : "idle";
        return Promise.resolve(okOut(JSON.stringify({ status: { state } })));
      }
      return Promise.resolve(ok);
    },
  });

  const outcome = await takeOverSession(
    {
      ...base,
      provider: "kimi",
      machine: "karpathy",
      targetMachine: "karpathy",
      terminal: "karpathy/t7",
      space: "karpathy/sp1",
      tab: "karpathy/tb2",
      pane: "karpathy/p4",
    },
    fake.runtime,
  );

  expect(fake.brimCalls).toEqual([
    {
      machine: "karpathy",
      cwd: "/repo",
      args: ["takeover", "--prepare", "--json", "--terminal", "t7"],
    },
  ]);
  expect(fake.calls).toEqual([
    "prepare",
    "tab.new",
    "tab.move",
    "tab.close",
    "hc:get",
    "hc:get",
    "hc:send",
  ]);
  expect(fake.hcCalls).toEqual([
    ["get", "karpathy/t9", "--json"],
    ["get", "karpathy/t9", "--json"],
    ["send", "karpathy/t9", samplePrepared.prompt],
  ]);
  expect(outcome.messageSent).toBe("typed");
});

test("Windows profile launcher degrades gracefully via hc read --lines 200", async () => {
  const fake = baseRuntime();
  const outcome = await takeOverSession(
    {
      ...base,
      launcher: "profile",
      machine: "desktop",
      targetMachine: "desktop",
      terminal: "desktop/t4",
      note: "Check failing tests",
    },
    fake.runtime,
  );

  expect(fake.brimCalls).toEqual([]);
  expect(fake.hcCalls[0]).toEqual(["read", "--lines", "200", "desktop/t4"]);
  expect(outcome.handoffPath).toBe("/state/handoffs/t4.md");
  expect(fake.newTabs[0]?.["task"]).toContain("Check failing tests");
  expect(fake.newTabs[0]?.["task"]).toContain("5-hour quota exhausted");
});

test("cross-machine preflight refuses dirty working tree, missing origin, or unpushed commits before touching any UI", async () => {
  const baseGitTable: Record<string, ExecResult> = {
    "--show-toplevel": okOut("/Users/jerred/git/monorepo\n"),
    "--git-common-dir": okOut("/Users/jerred/git/monorepo/.git\n"),
    "--porcelain": okOut(""),
    "rev-parse HEAD": okOut(`${headSha}\n`),
    "symbolic-ref": okOut("feat/unpushed\n"),
    "remote get-url": okOut("git@github.com:ShepherdJerred/monorepo.git\n"),
    "rev-list": okOut(`${headSha}\n`),
    "ls-remote": okOut(
      "0000000000000000000000000000000000000000\trefs/heads/feat/unpushed\n",
    ),
  };

  const dirty = baseRuntime({
    git: (_m, _c, args) =>
      Promise.resolve(
        gitTable(
          { ...baseGitTable, "--porcelain": okOut(" M src/index.ts\n") },
          args,
        ),
      ),
  });
  await expect(
    takeOverSession(
      { ...base, cwd: "/Users/jerred/git/monorepo", targetMachine: "mac-mini" },
      dirty.runtime,
    ),
  ).rejects.toThrow("uncommitted or untracked changes");
  expect(dirty.calls).toEqual([]);

  const unpushed = baseRuntime({
    git: (_m, _c, args) => Promise.resolve(gitTable(baseGitTable, args)),
  });
  await expect(
    takeOverSession(
      { ...base, cwd: "/Users/jerred/git/monorepo", targetMachine: "mac-mini" },
      unpushed.runtime,
    ),
  ).rejects.toThrow(
    'Branch "feat/unpushed" has unpushed commits not on origin',
  );
  expect(unpushed.calls).toEqual([]);

  const detached = baseRuntime({
    git: (_m, _c, args) =>
      Promise.resolve(
        gitTable(
          { ...baseGitTable, "symbolic-ref": fail("not a symbolic ref", 1) },
          args,
        ),
      ),
  });
  await expect(
    takeOverSession(
      { ...base, cwd: "/Users/jerred/git/monorepo", targetMachine: "mac-mini" },
      detached.runtime,
    ),
  ).rejects.toThrow("Detached HEAD has unpushed commits not on origin");
  expect(detached.calls).toEqual([]);
});

test("cross-machine main checkout migration fast-forwards clean target main, preserves subpath, opens space, and closes single-tab source space", async () => {
  const steps: string[] = [];
  const oldSha = "1111111111111111111111111111111111111111";
  const srcTable: Record<string, ExecResult> = {
    "--show-toplevel": okOut("/Users/jerred/git/monorepo\n"),
    "--git-common-dir": okOut("/Users/jerred/git/monorepo/.git\n"),
    "--porcelain": okOut(""),
    "rev-parse HEAD": okOut(`${headSha}\n`),
    "symbolic-ref": okOut("main\n"),
    "remote get-url": okOut("git@github.com:ShepherdJerred/monorepo.git\n"),
    "rev-list": okOut(`${headSha}\n`),
    "ls-remote": okOut(`${headSha}\trefs/heads/main\n`),
  };
  const dstTable: Record<string, ExecResult> = {
    "--git-common-dir": okOut("/Users/jerred/git/monorepo/.git\n"),
    "remote get-url": okOut("https://github.com/shepherdjerred/monorepo.git\n"),
    "fetch --prune": ok,
    "cat-file": ok,
    "merge --ff-only": ok,
    "worktree list": okOut(
      `worktree /Users/jerred/git/monorepo\nHEAD ${oldSha}\nbranch refs/heads/main\n\n`,
    ),
    "--porcelain": okOut(""),
  };

  const fake = baseRuntime({
    dirExists: (m, dir) =>
      Promise.resolve(m === "mac-mini" && dir === "/Users/jerred/git/monorepo"),
    git(machine, cwd, args) {
      fake.gitCalls.push({ machine, cwd, args });
      return Promise.resolve(
        gitTable(machine === null ? srcTable : dstTable, args),
      );
    },
  });

  const outcome = await takeOverSession(
    {
      ...base,
      cwd: "/Users/jerred/git/monorepo/packages/dotfiles",
      targetMachine: "mac-mini",
      spaceTabCount: 1,
      spaceName: "monorepo",
    },
    fake.runtime,
    (u) => {
      steps.push(u.step);
    },
  );

  expect(steps).toEqual([
    "preflight",
    "preparing",
    "syncing",
    "opening",
    "closing",
  ]);
  expect(fake.calls).toEqual([
    "prepare",
    "readHandoff",
    "writeTargetHandoff",
    "spaces.ls",
    "space.new",
    "space.close",
  ]);
  expect(fake.gitCalls).toContainEqual({
    machine: "mac-mini",
    cwd: "/Users/jerred/git/monorepo",
    args: ["merge", "--ff-only", headSha],
  });
  expect(fake.newSpaces).toEqual([
    {
      machine: "mac-mini",
      name: "monorepo",
      folder: "/Users/jerred/git/monorepo/packages/dotfiles",
      tab: "Fix cross-provider handoff",
      argv: ["brim", "--provider", "codex", "--", "--"],
      task: expect.stringContaining(
        "/Users/jerred/.toolkit/takeovers/handoff-123.md",
      ),
      focus: true,
    },
  ]);
  expect(fake.newSpaces[0]?.["task"]).toContain(
    "(Session migrated from local machine to mac-mini;",
  );
  expect(fake.closedSpaces).toEqual([{ id: "sp1", confirmed: true }]);
  expect(outcome).toEqual({
    title: "Fix cross-provider handoff",
    cwd: "/Users/jerred/git/monorepo/packages/dotfiles",
    handoffPath: "/Users/jerred/.toolkit/takeovers/handoff-123.md",
    terminal: "t9",
    tab: "tb-new",
    space: "sp-new",
    targetMachine: "mac-mini",
    migrated: true,
    splitTab: false,
    messageSent: "argument",
  });
});

test("cross-machine linked worktree migration creates suffixed worktree, attaches to existing target space, and closes only source split pane", async () => {
  const existingDirs = new Set([
    "/Users/jerred/Repos/monorepo",
    "/Users/jerred/.herdr/worktrees/monorepo/cross-provider-takeover",
  ]);
  const srcTable: Record<string, ExecResult> = {
    "--show-toplevel": okOut(
      "/Users/jerred/.herdr/worktrees/monorepo/cross-provider-takeover\n",
    ),
    "--git-common-dir": okOut("/Users/jerred/git/monorepo/.git\n"),
    "--porcelain": okOut(""),
    "rev-list": okOut(""),
    "rev-parse HEAD": okOut(`${headSha}\n`),
    "symbolic-ref": okOut("feat/cross-provider-takeover\n"),
    "remote get-url": okOut("git@github.com:ShepherdJerred/monorepo.git\n"),
  };
  const dstTable: Record<string, ExecResult> = {
    "--git-common-dir": okOut("/Users/jerred/Repos/monorepo/.git\n"),
    "remote get-url": okOut("git@github.com:ShepherdJerred/monorepo.git\n"),
    "fetch --prune": ok,
    "cat-file": ok,
    "worktree add": ok,
    "worktree list": okOut(
      `worktree /Users/jerred/Repos/monorepo\nHEAD ${headSha}\nbranch refs/heads/main\n\n`,
    ),
  };

  const fake = baseRuntime({
    dirExists: (m, dir) => Promise.resolve(m === null && existingDirs.has(dir)),
    listSpaces() {
      fake.calls.push("spaces.ls");
      return Promise.resolve([
        {
          id: "sp-local-wt",
          name: "cross-provider-takeover-2",
          folder:
            "/Users/jerred/.herdr/worktrees/monorepo/cross-provider-takeover-2",
          machine: null,
        },
      ]);
    },
    git(machine, cwd, args) {
      fake.gitCalls.push({ machine, cwd, args });
      return Promise.resolve(
        gitTable(machine === "karpathy" ? srcTable : dstTable, args),
      );
    },
  });

  const outcome = await takeOverSession(
    {
      ...base,
      terminal: "karpathy/t7",
      space: "karpathy/sp1",
      tab: "karpathy/tb2",
      pane: "karpathy/p-split",
      splitTab: true,
      cwd: "/Users/jerred/.herdr/worktrees/monorepo/cross-provider-takeover",
      machine: "karpathy",
      targetMachine: null,
      targetRepoCandidates: ["/Users/jerred/Repos/monorepo"],
    },
    fake.runtime,
  );

  expect(fake.gitCalls).toContainEqual({
    machine: null,
    cwd: "/Users/jerred/Repos/monorepo",
    args: [
      "worktree",
      "add",
      "-B",
      "feat/cross-provider-takeover",
      "/Users/jerred/.herdr/worktrees/monorepo/cross-provider-takeover-2",
      headSha,
    ],
  });
  expect(fake.newTabs).toEqual([
    {
      space: "sp-local-wt",
      folder:
        "/Users/jerred/.herdr/worktrees/monorepo/cross-provider-takeover-2",
      name: "Fix cross-provider handoff",
      argv: ["brim", "--provider", "codex", "--", "--"],
      task: expect.stringContaining(
        "/Users/jerred/.toolkit/takeovers/handoff-123.md",
      ),
      focus: true,
    },
  ]);
  expect(fake.selectedSpaces).toEqual([{ id: "sp-local-wt" }]);
  expect(fake.closePanes).toEqual([{ pane: "karpathy/p-split" }]);
  expect(fake.closeTabs).toEqual([]);
  expect(fake.closedSpaces).toEqual([]);
  expect(outcome.space).toBe("sp-local-wt");
  expect(outcome.migrated).toBe(true);
});

test("cross-OS migrations pair source preparation with source OS and target launch with target OS", async () => {
  const winToMac = baseRuntime({
    dirExists: (m, dir) =>
      Promise.resolve(m === "mac-mini" && dir === "/Users/jerred/scratch/demo"),
  });

  const outcome1 = await takeOverSession(
    {
      ...base,
      terminal: "jerred-desktop/t3",
      space: "jerred-desktop/sp1",
      tab: "jerred-desktop/tb1",
      pane: "jerred-desktop/p1",
      cwd: String.raw`C:\Users\Jerred\scratch\demo`,
      machine: "jerred-desktop",
      targetMachine: "mac-mini",
      launcher: "brim",
      spaceTabCount: 3,
    },
    winToMac.runtime,
  );

  expect(winToMac.brimCalls).toEqual([]);
  expect(winToMac.hcCalls[0]).toEqual([
    "read",
    "--lines",
    "200",
    "jerred-desktop/t3",
  ]);
  expect(winToMac.newSpaces[0]?.["argv"]).toEqual([
    "brim",
    "--provider",
    "codex",
    "--",
    "--",
  ]);
  expect(winToMac.newSpaces[0]?.["folder"]).toBe("/Users/jerred/scratch/demo");
  expect(winToMac.closeTabs).toEqual([
    { id: "jerred-desktop/tb1", confirmed: true },
  ]);
  expect(outcome1.handoffPath).toBe("/Users/jerred/.toolkit/takeovers/t3.md");

  const macToWin = baseRuntime({
    dirExists: (m, dir) =>
      Promise.resolve(
        m === "jerred-desktop" && dir === "C:/Users/Jerred/scratch/demo",
      ),
  });

  const outcome2 = await takeOverSession(
    {
      ...base,
      cwd: "/Users/jerred/scratch/demo",
      provider: "kimi",
      machine: null,
      targetMachine: "jerred-desktop",
      launcher: "profile",
      spaceTabCount: 2,
    },
    macToWin.runtime,
  );

  expect(macToWin.brimCalls).toHaveLength(1);
  expect(macToWin.newSpaces[0]?.["argv"]).toEqual(["kimi"]);
  expect(macToWin.calls).toEqual([
    "prepare",
    "readHandoff",
    "writeTargetHandoff",
    "spaces.ls",
    "space.new",
    "hc:get",
    "hc:send",
    "tab.close",
  ]);
  expect(macToWin.hcCalls).toEqual([
    ["get", "jerred-desktop/t9", "--json"],
    [
      "send",
      "jerred-desktop/t9",
      expect.stringContaining(
        "C:/Users/Jerred/.toolkit/takeovers/handoff-123.md",
      ),
    ],
  ]);
  expect(outcome2.messageSent).toBe("typed");
});

test("non-git folder migration fails cleanly when folder is absent on target machine", async () => {
  const fake = baseRuntime({
    dirExists: () => Promise.resolve(false),
  });
  await expect(
    takeOverSession(
      {
        ...base,
        cwd: "/Users/jerred/only-here",
        targetMachine: "mac-mini",
      },
      fake.runtime,
    ),
  ).rejects.toThrow(
    'Folder "/Users/jerred/only-here" is not a git repository and does not exist on mac-mini.',
  );
  expect(fake.calls).toEqual([]);
});

test("parsePreparedTakeover falls back to request cwd when prepared cwd is empty", () => {
  expect(
    parsePreparedTakeover(
      JSON.stringify({
        title: "  ",
        cwd: "",
        handoffPath: "/tmp/h.md",
        prompt: "Continue here",
      }),
      "/fallback/cwd",
    ),
  ).toEqual({
    title: "Session takeover",
    cwd: "/fallback/cwd",
    handoffPath: "/tmp/h.md",
    prompt: "Continue here",
  });
});

test("my-takeover/agents.js matches my-worktree/agents.js", async () => {
  const modsRoot = path.join(
    import.meta.dirname,
    "../private_dot_config/herdr-app/mods",
  );
  const [worktreeAgents, takeoverAgents] = await Promise.all([
    Bun.file(path.join(modsRoot, "my-worktree/agents.js")).text(),
    Bun.file(path.join(modsRoot, "my-takeover/agents.js")).text(),
  ]);
  expect(takeoverAgents).toBe(worktreeAgents);
});
