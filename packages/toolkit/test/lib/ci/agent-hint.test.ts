import { expect, test } from "vitest";
import { agentWaitHint } from "#lib/ci/wait/agent-hint.ts";

test("agent harnesses get their cheapest way to hold a long wait", () => {
  expect(agentWaitHint({ CODEX_THREAD_ID: "thread" })).toContain(
    '"yield_time_ms": 3600000',
  );
  expect(agentWaitHint({ CLAUDECODE: "1" })).toContain("run_in_background");
  expect(
    agentWaitHint({ CODEX_THREAD_ID: "thread", CLAUDECODE: "1" }),
  ).toContain("Codex");
  expect(agentWaitHint({})).toBeNull();
  expect(agentWaitHint({ CODEX_THREAD_ID: "", CLAUDECODE: "" })).toBeNull();
});
