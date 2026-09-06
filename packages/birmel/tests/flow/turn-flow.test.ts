import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FLOW_HARNESS_CHILD_TIMEOUT_MS,
  FLOW_RESULT_PREFIX,
  FlowHarnessResultSchema,
  type FlowHarnessResult,
  type FlowScenario,
  type FlowScenarioResult,
} from "./contracts.ts";

let harnessResult: FlowHarnessResult | undefined;
let temporaryDirectory: string | undefined;

function resultFor(scenario: FlowScenario): FlowScenarioResult {
  const result = harnessResult?.scenarios.find(
    (candidate) => candidate.scenario === scenario,
  );
  if (result == null) {
    throw new Error(`Missing flow scenario result: ${scenario}`);
  }
  return result;
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "birmel-flow-"));
  const databasePath = path.join(temporaryDirectory, "flow.db");
  const child = Bun.spawn(
    [
      "bun",
      "--no-install",
      "--bun",
      "vitest",
      "--config",
      "../../vitest.config.ts",
      "run",
    ],
    {
      cwd: import.meta.dir.replace(/\/tests\/flow$/u, ""),
      env: {
        ...Bun.env,
        DATABASE_PATH: databasePath,
        DATABASE_URL: `file:${databasePath}`,
        BIRMEL_VITEST_HARNESS: "tests/flow/flow-harness.ts",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Birmel flow harness failed with exit code ${String(exitCode)}\n${stdout}\n${stderr}`,
    );
  }
  const resultLine = stdout
    .split("\n")
    .find((line) => line.startsWith(FLOW_RESULT_PREFIX));
  if (resultLine == null) {
    throw new Error(
      `Birmel flow harness returned no result\n${stdout}\n${stderr}`,
    );
  }
  harnessResult = FlowHarnessResultSchema.parse(
    JSON.parse(resultLine.slice(FLOW_RESULT_PREFIX.length)),
  );
}, FLOW_HARNESS_CHILD_TIMEOUT_MS);

afterAll(async () => {
  if (temporaryDirectory != null) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("successful deterministic turn flow", () => {
  test("tool-free chat admits one run and edits one response exactly once", () => {
    const result = resultFor("conversation");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.replyPayloads).toEqual(["…"]);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.agentCalls).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.contextCalls).toBe(1);
    expect(result.memoryExtractionCalls).toBe(1);
    expect(result.routeDispositions).toEqual(["conversation"]);
    expect(result.toolCallCounts).toEqual([0]);
  });

  test("a tool-using turn runs one agent and one validated tool", () => {
    const result = resultFor("agent-tool");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.agentCalls).toBe(1);
    expect(result.toolCalls).toBe(1);
    expect(result.memoryExtractionCalls).toBe(1);
    expect(result.routeDispositions).toEqual(["supported"]);
    expect(result.toolCallCounts).toEqual([1]);
  });

  test("a working turn narrates into its own message and still ends on the answer", () => {
    const result = resultFor("agent-progress");

    expect(result.runStatuses).toEqual(["completed"]);
    // Still one reply. The extra edits are progress on that same message, so
    // the "one placeholder, one final state" contract is intact.
    expect(result.replyCalls).toBe(1);
    expect(result.deliveredEdits.length).toBeGreaterThan(1);
    expect(
      result.deliveredEdits.some((edit) => edit.includes("🔎 Working…")),
    ).toBe(true);
    expect(
      result.deliveredEdits.some((edit) =>
        edit.includes("Checking who has been active."),
      ),
    ).toBe(true);
    // Whatever progress showed, the last thing on screen is the answer.
    expect(result.deliveredEdits.at(-1)).toMatch(/^agent reply/u);
    expect(result.deliveredEdits.at(-1)).not.toContain("🔎 Working…");
  });

  test("restart-safe Discord message deduplication produces only one response", () => {
    const result = resultFor("dedupe");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.contextCalls).toBe(1);
    expect(result.agentCalls).toBe(1);
  });

  test("concurrent turns in one channel stay ordered through final delivery", () => {
    const result = resultFor("concurrent-ordering");

    expect(result.runStatuses).toEqual(["completed", "completed"]);
    expect(result.secondReplyObservedWhileFirstBlocked).toBe(false);
    expect(result.deliveryOrder).toEqual([
      "reply:10000000000000090",
      "edit:10000000000000090",
      "reply:10000000000000091",
      "edit:10000000000000091",
    ]);
    expect(result.replyCalls).toBe(2);
    expect(result.deliveredEdits).toHaveLength(2);
  });

  test("a queued session turn is suppressed if its exact session becomes inactive", () => {
    const result = resultFor("queued-session-inactive");

    expect(result.runStatuses).toEqual(["completed", "suppressed"]);
    expect(result.finishReasons).toEqual([
      "stop",
      "session-inactive-while-queued",
    ]);
    expect(result.replyCalls).toBe(1);
    expect(result.sessionEventCalls).toBe(2);
    expect(result.contextCalls).toBe(1);
    expect(result.agentCalls).toBe(1);
    expect(result.memoryExtractionCalls).toBe(1);
    expect(result.incidentIds).toEqual([]);
    expect(result.errorClasses).toEqual([]);
  });

  test("a memory deletion turn cannot immediately re-extract erased evidence", () => {
    const result = resultFor("memory-deletion");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.agentCalls).toBe(1);
    expect(result.memoryExtractionCalls).toBe(0);
    expect(result.incidentIds).toEqual([]);
  });
});

describe("boundary failures", () => {
  test("placeholder delivery failure records the incident without model work", () => {
    const result = resultFor("placeholder-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.editAttempts).toHaveLength(0);
    expect(result.contextCalls).toBe(0);
    expect(result.agentCalls).toBe(0);
    expect(result.incidentIds[0]).toMatch(/^B3-[0-9a-f]{8}$/u);
  });

  test("context failure replaces the placeholder with a content-free incident", () => {
    const result = resultFor("context-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.deliveredEdits[0]).toMatch(/Reference: B3-[0-9a-f]{8}$/u);
    expect(result.deliveredEdits[0]).not.toContain("CONTEXT_SECRET_EXCEPTION");
    expect(result.agentCalls).toBe(0);
  });

  test("an answer citing a tool call that never succeeded cannot reach Discord", () => {
    const result = resultFor("ungrounded-answer");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.deliveredEdits[0]).not.toContain("call-invented");
    expect(result.agentCalls).toBe(1);
  });

  test("agent failure returns only an incident reference", () => {
    const result = resultFor("agent-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.agentCalls).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.deliveredEdits[0]).not.toContain("AGENT_SECRET_EXCEPTION");
    expect(result.memoryExtractionCalls).toBe(0);
  });

  test("invalid tool output fails the turn before a model response is delivered", () => {
    const result = resultFor("tool-output-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.agentCalls).toBe(1);
    expect(result.toolCalls).toBe(1);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.deliveredEdits[0]).not.toContain(
      "TOOL_OUTPUT_SECRET_EXCEPTION",
    );
    expect(result.memoryExtractionCalls).toBe(0);
  });

  test("final delivery failure is recorded even when the incident cannot be delivered", () => {
    const result = resultFor("final-delivery-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.editAttempts).toHaveLength(2);
    expect(result.deliveredEdits).toHaveLength(0);
    expect(result.incidentIds[0]).toMatch(/^B3-[0-9a-f]{8}$/u);
    expect(result.errorClasses).toEqual(["Error"]);
    expect(result.memoryExtractionCalls).toBe(0);
  });

  test("session persistence failure cannot replace an already delivered response", () => {
    const result = resultFor("session-persistence-failure");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.editAttempts).toHaveLength(1);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.deliveredEdits[0]).toMatch(/^conversation reply/u);
    expect(result.incidentIds).toEqual([]);
    expect(result.memoryExtractionCalls).toBe(1);
  });

  test("run completion failure cannot cause a second final edit", () => {
    const result = resultFor("agent-run-completion-failure");

    expect(result.runStatuses).toEqual(["running"]);
    expect(result.editAttempts).toHaveLength(1);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.deliveredEdits[0]).toMatch(/^conversation reply/u);
    expect(result.incidentIds).toEqual([]);
    expect(result.memoryExtractionCalls).toBe(1);
  });

  test("post-response memory extraction failure warns without replacing the delivered reply", () => {
    const result = resultFor("memory-extraction-failure");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.editAttempts).toHaveLength(1);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.deliveredEdits[0]).toMatch(/^conversation reply/u);
    expect(result.memoryExtractionCalls).toBe(1);
    expect(result.memoryExtractionErrors).toBe(1);
    expect(result.incidentIds).toEqual([]);
  });
});

test("AgentRun SQLite schema and rows contain no assembled prompt or message content", () => {
  const result = resultFor("agent-run-persistence");
  const normalizedColumns = result.agentRunColumns.map((column) =>
    column.toLowerCase(),
  );

  expect(result.runStatuses).toEqual(["completed"]);
  expect(normalizedColumns).not.toContain("prompt");
  expect(normalizedColumns).not.toContain("content");
  expect(normalizedColumns).not.toContain("assembled");
  expect(normalizedColumns).toContain("routedisposition");
  expect(normalizedColumns).toContain("toolcallcount");
  expect(result.serializedAgentRuns).not.toContain(
    "ASSEMBLED_PROMPT_CONTENT_SENTINEL",
  );
});
