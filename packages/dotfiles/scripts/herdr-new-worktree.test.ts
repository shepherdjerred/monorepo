import { expect, test } from "vitest";
import {
  activeRun,
  createWorktree,
  launch,
  parseRequest,
  repoName,
  slug,
  startDetachedToolkit,
  type ExecResult,
  type Request,
  type Runtime,
} from "../bin/herdr_new_worktree_core.ts";

const base: Request = {
  message: "- fix the cache",
  provider: "codex",
  machine: null,
  repoMain: "/repo",
  repoTop: "/repo",
  root: "/home/.herdr/worktrees/repo",
  agentArgs: [],
  safe: false,
  launcher: "brim",
  argv: null,
  tab: null,
  sendMessage: true,
};
const named = { branch: "fix-cache", title: "Fix the cache" };
const ok: ExecResult = { code: 0, stdout: "", stderr: "" };
const steps: string[] = [];

function fakeRuntime(
  overrides: Partial<Runtime> = {},
  existing: readonly string[] = [],
) {
  const allocations: (readonly [Request, string])[] = [];
  const spaces: Record<string, unknown>[] = [];
  const hc: string[][] = [];
  const runtime: Runtime = {
    name: () => Promise.resolve(named),
    allocate(request, name) {
      allocations.push([request, name]);
      for (let n = 1; ; n++) {
        const candidate = n === 1 ? name : `${name}-${String(n)}`;
        if (request.branch !== undefined || !existing.includes(candidate))
          return Promise.resolve({
            branch: candidate,
            path: `${request.root}/${slug(candidate)}`,
            dedupe: "started",
          });
      }
    },
    newSpace(args) {
      spaces.push(args);
      return Promise.resolve("t9");
    },
    hc(args) {
      hc.push(args);
      if (args[0] === "get")
        return Promise.resolve({
          ...ok,
          stdout: JSON.stringify({ status: { state: "idle" } }),
        });
      return Promise.resolve(ok);
    },
    sleep: () => Promise.resolve(),
    ...overrides,
  };
  return { runtime, allocations, spaces, hc };
}

test("requests are checked strictly", () => {
  expect(parseRequest(JSON.stringify(base))).toEqual(base);
  expect(() => parseRequest("[]")).toThrow("JSON object");
  expect(() =>
    parseRequest(JSON.stringify({ ...base, agentArgs: [1] })),
  ).toThrow("agentArgs");
  expect(() => parseRequest(JSON.stringify({ ...base, message: "" }))).toThrow(
    "message",
  );
  expect(() => parseRequest(JSON.stringify({ ...base, safe: "no" }))).toThrow(
    "safe",
  );
  expect(() =>
    parseRequest(JSON.stringify({ ...base, launcher: undefined })),
  ).toThrow("launcher");
  expect(() =>
    parseRequest(JSON.stringify({ ...base, launcher: "fish" })),
  ).toThrow("launcher");
  expect(() =>
    parseRequest(JSON.stringify({ ...base, sendMessage: "yes" })),
  ).toThrow("sendMessage");
  expect(
    parseRequest(JSON.stringify({ ...base, sendMessage: undefined })),
  ).toMatchObject({ sendMessage: true });
});

test("on Windows an agent starts as its profile wrapper, agent-safe for plan modes", () => {
  const windows = { ...base, launcher: "profile" as const };
  expect(launch(windows, named)).toEqual({
    argv: ["codex", "--"],
    task: "- fix the cache",
    typed: false,
  });
  expect(
    launch(
      {
        ...windows,
        provider: "claude-code",
        agentArgs: ["--permission-mode", "plan"],
        safe: true,
      },
      named,
    ).argv,
  ).toEqual([
    "agent-safe",
    "claude",
    "--permission-mode",
    "plan",
    "--name",
    "Fix the cache",
    "--",
  ]);
  expect(launch({ ...windows, provider: "cursor" }, named).argv).toEqual([
    "cursor-agent",
    "--",
  ]);
  expect(() => launch({ ...windows, provider: "nope" }, named)).toThrow("nope");
});

test("a caller's own program gets the message as its task, and keeps its tab", async () => {
  const custom = { ...base, provider: null, argv: ["pi"], tab: "work" };
  expect(launch(custom, named)).toEqual({
    argv: ["pi"],
    task: "- fix the cache",
    typed: false,
  });
  const fake = fakeRuntime();
  await createWorktree(custom, fake.runtime, (update) => {
    steps.push(update.step);
  });
  expect(fake.spaces[0]).toMatchObject({ tab: "work", argv: ["pi"] });
  expect(
    parseRequest(JSON.stringify({ ...base, argv: undefined, tab: undefined })),
  ).toMatchObject({ argv: null, tab: null });
});

test("an active run names the repo and carries no message", () => {
  const run = activeRun(
    {
      ...base,
      machine: "mac-mini",
      root: "/Users/jerred/.herdr/worktrees/monorepo",
      message: "secret prompt",
    },
    {
      step: "worktree",
      title: "Fix the cache",
      branch: "fix-cache",
      path: "/Users/jerred/.herdr/worktrees/monorepo/fix-cache",
    },
    42,
  );
  expect(run).toEqual({
    pid: 42,
    machine: "mac-mini",
    repo: "monorepo",
    step: "worktree",
    title: "Fix the cache",
    branch: "fix-cache",
    path: "/Users/jerred/.herdr/worktrees/monorepo/fix-cache",
  });
  expect(JSON.stringify(run)).not.toContain("secret prompt");
  expect(repoName(String.raw`C:\Users\Jerred\.herdr\worktrees\monorepo`)).toBe(
    "monorepo",
  );
  expect(repoName("/Users/jerred/.herdr/worktrees/monorepo/")).toBe("monorepo");
});

test("slug turns slashes and spaces into dashes", () => {
  expect(slug("feat/new thing")).toBe("feat-new-thing");
});

test("most agents get the message as a protected trailing argument", () => {
  expect(launch(base, named)).toEqual({
    argv: ["brim", "--provider", "codex", "--", "--"],
    task: "- fix the cache",
    typed: false,
  });
});

test("Claude also gets the title, plan modes skip bypass flags", () => {
  expect(
    launch(
      {
        ...base,
        provider: "claude-code",
        agentArgs: ["--permission-mode", "plan"],
        safe: true,
      },
      named,
    ).argv,
  ).toEqual([
    "env",
    "AGENT_SAFE=1",
    "brim",
    "--provider",
    "claude-code",
    "--",
    "--permission-mode",
    "plan",
    "--name",
    "Fix the cache",
    "--",
  ]);
});

test("Antigravity takes -i, Kimi is typed, a shell gets nothing", () => {
  expect(launch({ ...base, provider: "antigravity" }, named)).toEqual({
    argv: ["brim", "--provider", "antigravity", "--", "-i", "- fix the cache"],
    task: null,
    typed: false,
  });
  expect(launch({ ...base, provider: "kimi" }, named)).toEqual({
    argv: ["brim", "--provider", "kimi", "--"],
    task: null,
    typed: true,
  });
  expect(launch({ ...base, provider: null }, named)).toEqual({
    argv: null,
    task: null,
    typed: false,
  });
});

test("when sendMessage is false, branch and tab are still named from description without sending a prompt", async () => {
  expect(launch({ ...base, sendMessage: false }, named)).toEqual({
    argv: ["brim", "--provider", "codex", "--"],
    task: null,
    typed: false,
  });
  expect(
    launch({ ...base, provider: "antigravity", sendMessage: false }, named),
  ).toEqual({
    argv: ["brim", "--provider", "antigravity", "--"],
    task: null,
    typed: false,
  });
  expect(
    launch({ ...base, provider: "claude-code", sendMessage: false }, named),
  ).toEqual({
    argv: [
      "brim",
      "--provider",
      "claude-code",
      "--",
      "--name",
      "Fix the cache",
    ],
    task: null,
    typed: false,
  });
  const fake = fakeRuntime();
  const outcome = await createWorktree(
    { ...base, provider: "kimi", sendMessage: false },
    fake.runtime,
    (update) => {
      steps.push(update.step);
    },
  );
  expect(outcome.messageSent).toBe("none");
  expect(fake.hc).toEqual([["label", "t9", "agent.task=Fix the cache"]]);
  expect(fake.spaces[0]).toEqual({
    folder: "/home/.herdr/worktrees/repo/fix-cache",
    machine: "",
    focus: false,
    name: "Fix the cache",
    tab: "Fix the cache",
    argv: ["brim", "--provider", "kimi", "--"],
  });
});

test("creates a fresh branch and opens the space on the right machine", async () => {
  const fake = fakeRuntime({}, ["fix-cache"]);
  const outcome = await createWorktree(
    { ...base, machine: "mac-mini" },
    fake.runtime,
    (update) => {
      steps.push(update.step);
    },
  );
  expect(outcome).toEqual({
    branch: "fix-cache-2",
    title: "Fix the cache",
    path: "/home/.herdr/worktrees/repo/fix-cache-2",
    terminal: "t9",
    messageSent: "argument",
    dedupe: "started",
  });
  expect(fake.allocations).toEqual([
    [{ ...base, machine: "mac-mini" }, "fix-cache"],
  ]);
  expect(fake.spaces).toEqual([
    {
      folder: "/home/.herdr/worktrees/repo/fix-cache-2",
      machine: "mac-mini",
      focus: false,
      name: "Fix the cache",
      tab: "Fix the cache",
      argv: ["brim", "--provider", "codex", "--", "--"],
      task: "- fix the cache",
    },
  ]);
  expect(fake.hc).toEqual([
    ["label", "mac-mini/t9", "agent.task=Fix the cache"],
  ]);
});

test("an explicit branch skips naming and opens an unnamed background space", async () => {
  const fake = fakeRuntime({
    name: () => Promise.reject(new Error("Unexpected naming")),
  });
  const request = parseRequest(
    JSON.stringify({ ...base, branch: "feat/keep" }),
  );
  const outcome = await createWorktree(request, fake.runtime, (update) => {
    steps.push(update.step);
  });
  expect(outcome).toMatchObject({
    branch: "feat/keep",
    title: null,
    messageSent: "none",
  });
  expect(fake.spaces).toEqual([
    {
      folder: "/home/.herdr/worktrees/repo/feat-keep",
      machine: "",
      focus: false,
      argv: ["brim", "--provider", "codex", "--"],
    },
  ]);
  expect(fake.hc).toEqual([]);
});

test("Kimi's message is typed once it is idle, at its machine address", async () => {
  let gets = 0;
  const fake = fakeRuntime({
    hc(args) {
      if (args[0] === "get") {
        gets++;
        const state = gets < 3 ? "blocked" : "idle";
        return Promise.resolve({
          ...ok,
          stdout: JSON.stringify({ status: { state } }),
        });
      }
      fake.hc.push(args);
      return Promise.resolve(ok);
    },
  });
  const outcome = await createWorktree(
    { ...base, provider: "kimi", machine: "mac-mini" },
    fake.runtime,
    (update) => {
      steps.push(update.step);
    },
  );
  expect(outcome.messageSent).toBe("typed");
  expect(steps.slice(-4)).toEqual(["naming", "worktree", "space", "message"]);
  expect(fake.hc).toEqual([
    ["label", "mac-mini/t9", "agent.task=Fix the cache"],
    ["send", "mac-mini/t9", "- fix the cache"],
  ]);
});

test("failures stop before any side effect they depend on", async () => {
  const naming = fakeRuntime({
    name: () => Promise.reject(new Error("OpenAI 401: bad key")),
  });
  await expect(
    createWorktree(base, naming.runtime, (update) => {
      steps.push(update.step);
    }),
  ).rejects.toThrow("OpenAI 401");
  expect(naming.allocations).toEqual([]);
  const adding = fakeRuntime({
    allocate: () => Promise.reject(new Error("fatal: path exists")),
  });
  await expect(
    createWorktree(base, adding.runtime, (update) => {
      steps.push(update.step);
    }),
  ).rejects.toThrow("fatal: path exists");
  expect(adding.spaces).toEqual([]);
});

test("a checkout with unavailable dedupe still opens its space", async () => {
  const fake = fakeRuntime({
    allocate: (request) =>
      Promise.resolve({
        branch: "work",
        path: `${request.root}/work`,
        dedupe: "skipped",
      }),
  });
  const outcome = await createWorktree(base, fake.runtime, (update) => {
    steps.push(update.step);
  });
  expect(outcome).toMatchObject({ terminal: "t9", dedupe: "skipped" });
  expect(fake.spaces).toHaveLength(1);
});

test("the detached toolkit starter reports a missing toolkit instead of failing", async () => {
  expect(
    await startDetachedToolkit("/nonexistent/.local/bin/toolkit", "/", ["x"]),
  ).toBe(false);
});
