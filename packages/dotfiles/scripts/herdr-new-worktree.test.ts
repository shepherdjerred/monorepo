import { expect, test } from "vitest";
import {
  activeRun,
  createWorktree,
  launch,
  parseRequest,
  repoName,
  slug,
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
};
const named = { branch: "fix-cache", title: "Fix the cache" };
const ok: ExecResult = { code: 0, stdout: "", stderr: "" };
const steps: string[] = [];

function fakeRuntime(
  overrides: Partial<Runtime> = {},
  existing: readonly string[] = [],
) {
  const git: string[][] = [];
  const spaces: Record<string, unknown>[] = [];
  const hc: string[][] = [];
  const runtime: Runtime = {
    name: () => Promise.resolve(named),
    async freeBranch(name, taken) {
      for (let n = 1; ; n++) {
        const candidate = n === 1 ? name : `${name}-${String(n)}`;
        if (!(await taken(candidate))) return candidate;
      }
    },
    git(machine, cwd, args) {
      git.push([String(machine), cwd, ...args]);
      if (args[0] === "show-ref")
        return Promise.resolve({
          ...ok,
          code: existing.includes(String(args[3]).slice(11)) ? 0 : 1,
        });
      return Promise.resolve(ok);
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
  return { runtime, git, spaces, hc };
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
  });
  expect(fake.git).toContainEqual([
    "mac-mini",
    "/repo",
    "worktree",
    "add",
    "-b",
    "fix-cache-2",
    "/home/.herdr/worktrees/repo/fix-cache-2",
    "HEAD",
  ]);
  expect(fake.spaces).toEqual([
    {
      folder: "/home/.herdr/worktrees/repo/fix-cache-2",
      machine: "mac-mini",
      name: "Fix the cache",
      tab: "Fix the cache",
      argv: ["brim", "--provider", "codex", "--", "--"],
      task: "- fix the cache",
    },
  ]);
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
  expect(steps.slice(-5)).toEqual([
    "naming",
    "branch",
    "worktree",
    "space",
    "message",
  ]);
  expect(fake.hc).toEqual([["send", "mac-mini/t9", "- fix the cache"]]);
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
  expect(naming.git).toEqual([]);
  const adding = fakeRuntime({
    git: (_machine, _cwd, args) =>
      Promise.resolve(
        args[0] === "worktree"
          ? { code: 128, stdout: "", stderr: "fatal: path exists\n" }
          : { ...ok, code: args[0] === "show-ref" ? 1 : 0 },
      ),
  });
  await expect(
    createWorktree(base, adding.runtime, (update) => {
      steps.push(update.step);
    }),
  ).rejects.toThrow("fatal: path exists");
  expect(adding.spaces).toEqual([]);
});
