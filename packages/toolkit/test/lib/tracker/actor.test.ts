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
    ["OPENCODE_SESSION_ID", "opencode"],
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
  test("interactive humans are named; noninteractive or unidentified agents fail", () => {
    expect(detectActor({}, { ...context, interactive: true }).key).toBe(
      "human:jerred",
    );
    expect(() => detectActor({}, context)).toThrow("native session ID");
    expect(() =>
      detectActor({ CLAUDECODE: "1" }, { ...context, interactive: true }),
    ).toThrow("native session ID");
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
