import { describe, expect, test } from "vitest";
import { detectActor, type ActorContext } from "#lib/tracker/actor.ts";

const context: ActorContext = {
  interactive: false,
  name: "jerred",
  cwd: "/repo",
  hostname: "workstation",
  branch: "feat/tracker",
  repoHead: "abc",
  worktree: "/repo",
};
const interactiveContext: ActorContext = {
  ...context,
  interactive: true,
};

describe("tracker actor attribution", () => {
  test("native hooks select a nested harness over inherited parent identity", () => {
    expect(
      detectActor(
        {
          CODEX_THREAD_ID: "parent",
          CURSOR_CONVERSATION_ID: "child",
          TRACKER_ACTOR_HARNESS: "cursor",
        },
        context,
      ).key,
    ).toBe("cursor:child");
    expect(() =>
      detectActor(
        { CODEX_THREAD_ID: "parent", TRACKER_ACTOR_HARNESS: "cursor" },
        context,
      ),
    ).toThrow("Missing native session");
  });
  test.each([
    ["CODEX_THREAD_ID", "codex"],
    ["CLAUDE_CODE_SESSION_ID", "claude-code"],
    ["CURSOR_CONVERSATION_ID", "cursor"],
    ["GROK_SESSION_ID", "grok"],
    ["ANTIGRAVITY_CONVERSATION_ID", "antigravity"],
    ["KIMI_SESSION_ID", "kimi"],
    ["MUSE_SESSION_ID", "muse"],
  ])(
    "native %s stays stable on resume and differs across sessions",
    (variable, harness) => {
      const first = detectActor({ [variable]: "session-1" }, context);
      const resumed = detectActor(
        { [variable]: "session-1" },
        { ...context, branch: "another-branch" },
      );
      const next = detectActor({ [variable]: "session-2" }, context);
      expect(first.key).toBe(`${harness}:session-1`);
      expect(resumed.key).toBe(first.key);
      expect(next.key).not.toBe(first.key);
      expect(first.kind).toBe("agent");
      expect(first.metadata).toMatchObject({
        harness,
        sessionId: "session-1",
        repoHead: "abc",
      });
    },
  );
  test("Antigravity resolves conversation or trajectory ID in a PTY and fails closed without one", () => {
    const conversation = detectActor(
      {
        ANTIGRAVITY_AGENT: "1",
        ANTIGRAVITY_CONVERSATION_ID: "conv-42",
        ANTIGRAVITY_TRAJECTORY_ID: "traj-ignored",
      },
      interactiveContext,
    );
    expect(conversation).toMatchObject({
      key: "antigravity:conv-42",
      kind: "agent",
      name: "antigravity",
    });

    const trajectory = detectActor(
      {
        ANTIGRAVITY_AGENT: "1",
        ANTIGRAVITY_TRAJECTORY_ID: "traj-99",
      },
      interactiveContext,
    );
    expect(trajectory).toMatchObject({
      key: "antigravity:traj-99",
      kind: "agent",
      name: "antigravity",
    });

    expect(() =>
      detectActor({ ANTIGRAVITY_AGENT: "1" }, interactiveContext),
    ).toThrow("native session ID");
  });
  test("kimi and muse fall back to AGENT_LAUNCH_ID while native-hook harnesses still fail loudly", () => {
    expect(
      detectActor(
        {
          AGENT_CLI: "kimi",
          AGENT_LAUNCH_ID: "11111111-2222-3333-4444-555555555555",
        },
        interactiveContext,
      ),
    ).toMatchObject({
      key: "kimi:11111111-2222-3333-4444-555555555555",
      kind: "agent",
      name: "kimi",
    });

    expect(
      detectActor(
        {
          AI_AGENT: "muse",
          AGENT_LAUNCH_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        },
        interactiveContext,
      ),
    ).toMatchObject({
      key: "muse:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      kind: "agent",
      name: "muse",
    });

    expect(
      detectActor(
        {
          CODEX_THREAD_ID: "parent",
          AGENT_CLI: "kimi",
          AGENT_LAUNCH_ID: "child-launch",
          TRACKER_ACTOR_HARNESS: "kimi",
        },
        interactiveContext,
      ).key,
    ).toBe("kimi:child-launch");

    for (const cli of ["claude", "codex", "cursor-agent", "grok", "agy"]) {
      expect(() =>
        detectActor(
          {
            AGENT_CLI: cli,
            AI_AGENT: cli,
            AGENT_LAUNCH_ID: "11111111-2222-3333-4444-555555555555",
          },
          interactiveContext,
        ),
      ).toThrow("native session ID");
    }
  });
});

describe("tracker actor guards and overrides", () => {
  test("agent git and GitHub config paths prevent falling back to human identity in a PTY", () => {
    expect(() =>
      detectActor(
        { GIT_CONFIG_GLOBAL: "/Users/test/.config/agent/gitconfig" },
        interactiveContext,
      ),
    ).toThrow("native session ID");
    expect(() =>
      detectActor(
        { GH_CONFIG_DIR: "/Users/test/.config/gh-agent" },
        interactiveContext,
      ),
    ).toThrow("native session ID");
    expect(() =>
      detectActor({ HC_AGENT_APP: "antigravity" }, interactiveContext),
    ).toThrow("native session ID");
  });
  test("rejects human actor key or kind whenever an agent environment is detected", () => {
    for (const agentEnv of [
      { CODEX_THREAD_ID: "session-1" },
      { ANTIGRAVITY_AGENT: "1" },
      { AGENT_CLI: "claude", AGENT_LAUNCH_ID: "uuid-1" },
      { GIT_CONFIG_GLOBAL: "/Users/test/.config/agent/gitconfig" },
      { GH_CONFIG_DIR: "/Users/test/.config/gh-agent" },
    ]) {
      expect(() =>
        detectActor(
          {
            ...agentEnv,
            TRACKER_ACTOR_KEY: "human:jerred",
            TRACKER_ACTOR_KIND: "human",
          },
          interactiveContext,
        ),
      ).toThrow("Agent sessions cannot use a human Tracker actor identity");
      expect(() =>
        detectActor(
          {
            ...agentEnv,
            TRACKER_ACTOR_KEY: "human:jerred",
            TRACKER_ACTOR_KIND: "agent",
          },
          interactiveContext,
        ),
      ).toThrow("Agent sessions cannot use a human Tracker actor identity");
      expect(() =>
        detectActor(
          {
            ...agentEnv,
            TRACKER_ACTOR_KEY: "agent:override",
            TRACKER_ACTOR_KIND: "human",
          },
          interactiveContext,
        ),
      ).toThrow("Agent sessions cannot use a human Tracker actor identity");
    }
  });
  test("records the hc terminal address and ignores the retired Herdr workspace", () => {
    const actor = detectActor(
      {
        CODEX_THREAD_ID: "session",
        HC_TERMINAL_ID: "t7",
        HERDR_WORKSPACE_ID: "retired",
      },
      context,
    );
    expect(actor.metadata).toMatchObject({ hcTerminal: "t7" });
    expect(actor.metadata).not.toHaveProperty("herdrWorkspace");
  });
  test("explicit runners override native identity and include configured metadata", () => {
    const actor = detectActor(
      {
        CODEX_THREAD_ID: "session",
        TRACKER_ACTOR_KEY: "justin:AI-1",
        TRACKER_ACTOR_KIND: "runner",
        TRACKER_ACTOR_NAME: "Justin",
        TRACKER_ACTOR_MODEL: "reported-model",
        TRACKER_ACTOR_PLAN: "plan",
        TRACKER_PARENT_ACTOR_KEY: "codex:parent",
        SECRET_TOKEN: "never-record-this",
      },
      context,
    );
    expect(actor).toMatchObject({
      key: "justin:AI-1",
      kind: "runner",
      name: "Justin",
      metadata: {
        model: "reported-model",
        plan: "plan",
        parentKey: "codex:parent",
      },
    });
    expect(JSON.stringify(actor)).not.toContain("never-record-this");
  });
  test("an explicit harness selects Grok over an inherited parent session", () => {
    expect(
      detectActor(
        {
          CODEX_THREAD_ID: "parent",
          GROK_SESSION_ID: "grok-session",
          TRACKER_ACTOR_HARNESS: "grok",
        },
        context,
      ).key,
    ).toBe("grok:grok-session");
  });
  test("interactive humans are named; noninteractive or unidentified agents fail", () => {
    expect(detectActor({}, interactiveContext).key).toBe("human:jerred");
    expect(() => detectActor({}, context)).toThrow("native session ID");
    expect(() => detectActor({ CLAUDECODE: "1" }, interactiveContext)).toThrow(
      "native session ID",
    );
    expect(() => detectActor({ GROK_AGENT: "1" }, interactiveContext)).toThrow(
      "native session ID",
    );
    expect(() =>
      detectActor({ TRACKER_ACTOR_KEY: "runner:job" }, context),
    ).toThrow("TRACKER_ACTOR_KIND");
    expect(() =>
      detectActor(
        { TRACKER_ACTOR_KEY: "invalid", TRACKER_ACTOR_KIND: "agent" },
        context,
      ),
    ).toThrow();
  });
});
