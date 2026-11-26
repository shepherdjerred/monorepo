import { describe, expect, test, vi } from "vitest";
import {
  chooseActor,
  parseTarget,
  resolveReach,
  type ReachActor,
} from "#lib/agent/reach.ts";
import type { HerdrTerminal } from "#lib/agent/herdr.ts";
import { agentReach, agentSend, type AgentDeps } from "#commands/agent.ts";

const creator: ReachActor = {
  key: "claude-code:creator-session",
  kind: "agent",
  name: "claude-code",
  lastSeenAt: "2026-11-25T00:00:00.000Z",
  metadata: {
    harness: "claude-code",
    sessionId: "creator-session",
    hcTerminal: "t1",
  },
};
const assignee: ReachActor = {
  key: "codex:worker-session",
  kind: "agent",
  name: "codex",
  lastSeenAt: "2026-11-25T01:00:00.000Z",
  metadata: {
    harness: "codex",
    sessionId: "worker-session",
    hcTerminal: "t5d",
    hostname: "karpathy",
  },
};

function terminal(
  partial: Partial<HerdrTerminal> & { address: string },
): HerdrTerminal {
  const bare = partial.address.slice(partial.address.lastIndexOf("/") + 1);
  return {
    bare,
    machine: partial.address.includes("/")
      ? partial.address.slice(0, partial.address.indexOf("/"))
      : null,
    app: "codex",
    state: "idle",
    cwd: "/repo",
    where: null,
    ...partial,
  };
}

describe("parseTarget", () => {
  test.each([
    ["AI-123", "issue"],
    ["SJ-4", "issue"],
    ["FM-45", "forum"],
    ["00000000-0000-4000-8000-000000000012", "forum"],
    ["muse:01a2162a-c1f1-75a2-9368-54e0886d1106", "actor"],
    ["t91", "terminal"],
    ["karpathy/t5d", "terminal"],
  ])("classifies %s as %s", (raw, kind) => {
    expect(parseTarget(raw).kind).toBe(kind);
  });
  test("rejects an empty target", () => {
    expect(() => parseTarget("  ")).toThrow("Target is required");
  });
});

describe("chooseActor", () => {
  test("prefers assignee over creator and owner over creator", () => {
    expect(
      chooseActor({ identifier: "AI-1", title: "t", creator, assignee }).actor
        .key,
    ).toBe(assignee.key);
    expect(
      chooseActor({ identifier: "FM-1", title: "t", creator, owner: assignee })
        .actor.key,
    ).toBe(assignee.key);
    expect(
      chooseActor({ identifier: "AI-1", title: "t", creator, assignee: null })
        .role,
    ).toBe("creator");
  });
});

describe("resolveReach", () => {
  const locations = new Map();
  test("resolves a unique bare terminal locally", () => {
    const result = resolveReach({
      target: "AI-1",
      actor: creator,
      role: "creator",
      terminals: [terminal({ address: "t1" })],
      machines: [],
      locations,
    });
    expect(result).toMatchObject({
      address: "t1",
      live: true,
      reachable: true,
    });
    expect(result.sendCommand).toContain("hc send t1");
  });
  test("qualifies a bare id found on exactly one remote core", () => {
    const result = resolveReach({
      target: "AI-1",
      actor: assignee,
      role: "assignee",
      terminals: [terminal({ address: "karpathy/t5d" })],
      machines: ["karpathy"],
      locations,
    });
    expect(result.address).toBe("karpathy/t5d");
  });
  test("breaks duplicate bare ids by actor hostname, else reports ambiguity", () => {
    const terminals = [
      terminal({ address: "t5d" }),
      terminal({ address: "karpathy/t5d" }),
    ];
    const byHost = resolveReach({
      target: "AI-1",
      actor: assignee,
      terminals,
      machines: ["karpathy"],
      locations,
    });
    expect(byHost.address).toBe("karpathy/t5d");
    const ambiguous = resolveReach({
      target: "AI-1",
      actor: {
        ...creator,
        metadata: { ...creator.metadata, hostname: "desktop" },
      },
      terminals: [
        terminal({ address: "t1" }),
        terminal({ address: "karpathy/t1" }),
      ],
      machines: ["karpathy"],
      locations,
    });
    expect(ambiguous.reachable).toBe(false);
    expect(ambiguous.reason).toContain("disambiguate");
  });
  test("reports a dead terminal and a missing hc record", () => {
    const gone = resolveReach({
      target: "AI-1",
      actor: assignee,
      terminals: [],
      machines: [],
      locations,
    });
    expect(gone).toMatchObject({ live: false, reachable: false });
    expect(gone.reason).toContain("not live");
    const noHc = resolveReach({
      target: "AI-1",
      actor: { ...creator, metadata: {} },
      terminals: [],
      machines: [],
      locations,
    });
    expect(noHc.reason).toContain("no hc terminal");
  });
  test("marks blocked terminals unreachable without force", () => {
    const result = resolveReach({
      target: "AI-1",
      actor: creator,
      terminals: [terminal({ address: "t1", state: "blocked" })],
      machines: [],
      locations,
    });
    expect(result).toMatchObject({ live: true, reachable: false });
    expect(result.reason).toContain("blocked");
  });
});

function fakeDeps(overrides: { state?: string; live?: boolean } = {}) {
  const comments: string[] = [];
  const replies: string[] = [];
  const sends: { address: string; text: string; force: boolean }[] = [];
  const live = overrides.live !== false;
  const deps: AgentDeps = {
    tracker: {
      issue: () =>
        Promise.resolve({ identifier: "AI-1", title: "t", creator, assignee }),
      forum: () =>
        Promise.resolve({
          identifier: "FM-1",
          title: "t",
          creator,
          owner: assignee,
        }),
      actorByKey: (key) =>
        Promise.resolve(key === assignee.key ? assignee : creator),
      comment: (_id, body) => {
        comments.push(body);
        return Promise.resolve();
      },
      reply: (_id, body) => {
        replies.push(body);
        return Promise.resolve();
      },
      sender: () =>
        Promise.resolve({
          key: "muse:sender",
          kind: "agent" as const,
          name: "muse",
          metadata: { hcTerminal: "t91" },
        }),
    },
    herdr: {
      list: () =>
        Promise.resolve({
          machines: ["karpathy"],
          terminals: live
            ? [
                terminal({
                  address: "karpathy/t5d",
                  state: overrides.state ?? "idle",
                }),
              ]
            : [],
        }),
      get: () => Promise.resolve(null),
      locations: () => Promise.resolve(new Map()),
      send: (address: string, text: string, force: boolean) => {
        sends.push({ address, text, force });
        return Promise.resolve({ exitCode: 0, stdout: "{}", stderr: "" });
      },
    },
  };
  return { deps, comments, replies, sends };
}

describe("agentReach / agentSend", () => {
  test("reach resolves an issue to its assignee's qualified terminal", async () => {
    const { deps } = fakeDeps();
    const result = await agentReach(deps, "AI-1");
    expect(result).toMatchObject({
      address: "karpathy/t5d",
      role: "assignee",
      reachable: true,
    });
    expect(result.actor?.key).toBe(assignee.key);
  });
  test("send delivers with a reply-to header and no force", async () => {
    const { deps, sends } = fakeDeps();
    const result = await agentSend(deps, "AI-1", "please recheck");
    expect(result.delivered).toBe(true);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ address: "karpathy/t5d", force: false });
    expect(sends[0]?.text).toContain("from muse:sender");
    expect(sends[0]?.text).toContain("please recheck");
  });
  test("blocked target falls back to exactly one forum reply / issue comment", async () => {
    const forum = fakeDeps({ state: "blocked" });
    const forumResult = await agentSend(forum.deps, "FM-1", "heads up");
    expect(forumResult).toMatchObject({ delivered: false, fallback: "reply" });
    expect(forum.replies).toHaveLength(1);
    expect(forum.replies[0]).toContain("heads up");
    expect(forum.sends).toHaveLength(0);

    const issue = fakeDeps({ state: "blocked" });
    const issueResult = await agentSend(issue.deps, "AI-1", "heads up");
    expect(issueResult).toMatchObject({
      delivered: false,
      fallback: "comment",
    });
    expect(issue.comments).toHaveLength(1);
  });
  test("dead target preserves the message; --no-fallback writes nothing", async () => {
    const dead = fakeDeps({ live: false });
    const result = await agentSend(dead.deps, "AI-1", "are you there");
    expect(result).toMatchObject({ delivered: false, fallback: "comment" });
    expect(dead.comments[0]).toContain("are you there");

    const noFallback = fakeDeps({ live: false });
    const skipped = await agentSend(noFallback.deps, "AI-1", "lost", {
      fallback: false,
    });
    expect(skipped).toMatchObject({ delivered: false, fallback: null });
    expect(noFallback.comments).toHaveLength(0);
  });
  test("--force sends to a blocked terminal", async () => {
    const { deps, sends } = fakeDeps({ state: "blocked" });
    const result = await agentSend(deps, "AI-1", "interrupt", { force: true });
    expect(result).toMatchObject({ delivered: true, forced: true });
    expect(sends[0]?.force).toBe(true);
  });
  test("direct terminal targets need no Tracker lookup", async () => {
    const { deps } = fakeDeps();
    deps.tracker.issue = vi.fn(() =>
      Promise.reject(new Error("should not be called")),
    );
    const result = await agentReach(deps, "karpathy/t5d");
    expect(result).toMatchObject({ address: "karpathy/t5d", live: true });
  });
});
