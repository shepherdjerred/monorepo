import { expect, it } from "vitest";
import { codingRoutes } from "#commands/agent.ts";
import { runAgent, type Response } from "./agent-fixture.ts";

it("uses the connected alias for a coding peer and keeps offline hosts visible", () => {
  expect(
    codingRoutes("karpathy", {
      machines: [
        { name: "macbook", target: "macbook", state: "unreachable" },
        { name: "mac-current", target: "macbook", state: "connected" },
        { name: "jobs", target: "jobs", state: "connected" },
      ],
    }),
  ).toEqual([
    { host: "macbook", addressPrefix: "mac-current", connected: true },
    { host: "karpathy", addressPrefix: null, connected: true },
    { host: "desktop", addressPrefix: null, connected: false },
  ]);
});

function presenceResponses(): Record<string, Response> {
  return {
    machine: {
      body: {
        machines: [{ name: "desk", target: "desktop", state: "connected" }],
      },
    },
    ls: {
      body: {
        terminals: [
          {
            address: "desk/t1",
            agent: "codex",
            status: "working",
            state: "live",
          },
          {
            address: "desk/t2",
            agent: "codex",
            state: "live",
            cwd: "/fallback",
          },
          { address: "desk/t3", agent: "codex", state: "live" },
          { address: "desk/t4", agent: "codex", state: "finished" },
          { address: "desk/t5", agent: "", state: "live" },
        ],
      },
    },
    "get desk/t1": {
      body: {
        state: "live",
        cwd: "/shell",
        foreground: { cwd: "/worktree" },
        labels: {
          "agent.task": " Review the pool ",
          "agent.issue": "AI-983",
          "private.token": "secret-label-value",
        },
      },
    },
    "get desk/t2": { code: 7, stderr: "secret-provider-stderr" },
    "get desk/t3": { body: { state: "finished" } },
  };
}

it("executes presence, forwards addresses, and limits output to public agent fields", async () => {
  const result = await runAgent(["presence", "--json"], presenceResponses());
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  const output: unknown = JSON.parse(result.stdout);
  expect(output).toMatchObject({
    agents: [
      {
        host: "desktop",
        address: "desk/t1",
        agent: "codex",
        status: "working",
        worktree: "/worktree",
        task: "Review the pool",
        issue: "AI-983",
        detailsAvailable: true,
      },
      {
        host: "desktop",
        address: "desk/t2",
        status: "unknown",
        worktree: "/fallback",
        task: null,
        issue: null,
        detailsAvailable: false,
      },
    ],
  });
  expect(result.stdout).not.toContain("secret-");
  expect(
    result.calls
      .map((call) => call.args)
      .sort((a, b) => a.join(" ").localeCompare(b.join(" "))),
  ).toEqual([
    ["get", "desk/t1", "--json"],
    ["get", "desk/t2", "--json"],
    ["get", "desk/t3", "--json"],
    ["ls", "--json"],
    ["machine", "ls", "--json"],
  ]);
  expect(result.calls.every((call) => call.terminal === null)).toBe(true);
});

it("prints readable presence and reports missing terminal details", async () => {
  const result = await runAgent(["presence"], presenceResponses());
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(
    "desk/t1 · codex · working · Review the pool · AI-983 · /worktree",
  );
  expect(result.stdout).toContain("terminal details unavailable");
});

it("forwards scope labels as literal arguments and can clear them", async () => {
  const result = await runAgent(
    ["scope", "--task", " Review & ship $(literal) ", "--issue", "AI-983"],
    { label: {} },
  );
  expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
  expect(result.calls).toEqual([
    {
      args: [
        "label",
        "t7p",
        "agent.task=Review & ship $(literal)",
        "agent.issue=AI-983",
        "--json",
      ],
      terminal: null,
    },
  ]);
  const cleared = await runAgent(["scope", "--task", "", "--issue", ""], {
    label: {},
  });
  expect(cleared.code).toBe(0);
  expect(cleared.calls[0]?.args).toEqual([
    "label",
    "t7p",
    "agent.task=",
    "agent.issue=",
    "--json",
  ]);
});

it.each([
  { args: ["scope"], terminal: "t7p", error: "Provide --task or --issue" },
  {
    args: ["scope", "--task", "x"],
    terminal: null,
    error: "inside a Herdr terminal",
  },
  {
    args: ["scope", "--task", "x"],
    terminal: "desktop/t1",
    error: "inside a Herdr terminal",
  },
  {
    args: ["scope", "--task", "a\nb"],
    terminal: "t7p",
    error: "single short title",
  },
  {
    args: ["scope", "--issue", "AI-0"],
    terminal: "t7p",
    error: "Tracker identifier",
  },
  { args: ["presence", "--bad"], terminal: "t7p", error: "Unknown option" },
  { args: ["unknown"], terminal: "t7p", error: "Unknown agent command" },
])(
  "rejects invalid arguments before starting hc: $error",
  async ({ args, terminal, error }) => {
    const result = await runAgent(args, {}, terminal);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(error);
    expect(result.calls).toEqual([]);
  },
);

it.each([
  { args: ["presence", "--json"], command: "machine" },
  { args: ["scope", "--task", "Review"], command: "label" },
])(
  "fails on hc errors without echoing child output: $command",
  async ({ args, command }) => {
    const responses = presenceResponses();
    responses[command] = {
      code: 9,
      stderr: "secret-provider-stderr",
      body: { token: "secret-stdout" },
    };
    const result = await runAgent(args, responses);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`hc ${command} failed (exit 9)`);
    expect(result.stdout + result.stderr).not.toContain("secret-");
  },
);
