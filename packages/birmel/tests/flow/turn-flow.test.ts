import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
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
  const child = Bun.spawn(["bun", "run", "tests/flow/flow-harness.ts"], {
    cwd: import.meta.dir.replace(/\/tests\/flow$/u, ""),
    env: {
      ...Bun.env,
      DATABASE_PATH: databasePath,
      DATABASE_URL: `file:${databasePath}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
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
}, 30_000);

afterAll(async () => {
  if (temporaryDirectory != null) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("successful deterministic turn flow", () => {
  test("direct chat admits one run and edits one response exactly once", () => {
    const result = resultFor("direct");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.replyPayloads).toEqual(["…"]);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.directCalls).toBe(1);
    expect(result.specialistCalls).toBe(0);
    expect(result.toolCalls).toBe(0);
    expect(result.contextCalls).toBe(1);
    expect(result.routerCalls).toBe(1);
    expect(result.memoryExtractionCalls).toBe(1);
  });

  test("typed specialist route executes exactly one specialist and one validated tool", () => {
    const result = resultFor("specialist-tool");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.directCalls).toBe(0);
    expect(result.specialistCalls).toBe(1);
    expect(result.toolCalls).toBe(1);
    expect(result.memoryExtractionCalls).toBe(1);
  });

  test("restart-safe Discord message deduplication produces only one response", () => {
    const result = resultFor("dedupe");

    expect(result.runStatuses).toEqual(["completed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.contextCalls).toBe(1);
    expect(result.routerCalls).toBe(1);
    expect(result.directCalls).toBe(1);
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
});

describe("boundary failures", () => {
  test("placeholder delivery failure records the incident without model work", () => {
    const result = resultFor("placeholder-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.replyCalls).toBe(1);
    expect(result.editAttempts).toHaveLength(0);
    expect(result.contextCalls).toBe(0);
    expect(result.routerCalls).toBe(0);
    expect(result.incidentIds[0]).toMatch(/^B3-[0-9a-f]{8}$/u);
  });

  test("context failure replaces the placeholder with a content-free incident", () => {
    const result = resultFor("context-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.deliveredEdits[0]).toMatch(/Reference: B3-[0-9a-f]{8}$/u);
    expect(result.deliveredEdits[0]).not.toContain("CONTEXT_SECRET_EXCEPTION");
    expect(result.routerCalls).toBe(0);
    expect(result.directCalls).toBe(0);
  });

  test("malformed router output cannot reach an executor", () => {
    const result = resultFor("router-malformed");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.deliveredEdits).toHaveLength(1);
    expect(result.deliveredEdits[0]).not.toContain("secondRoute");
    expect(result.routerCalls).toBe(1);
    expect(result.directCalls).toBe(0);
    expect(result.specialistCalls).toBe(0);
  });

  test("specialist failure returns only an incident reference", () => {
    const result = resultFor("specialist-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.specialistCalls).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.deliveredEdits[0]).not.toContain(
      "SPECIALIST_SECRET_EXCEPTION",
    );
    expect(result.memoryExtractionCalls).toBe(0);
  });

  test("invalid tool output fails the turn before a model response is delivered", () => {
    const result = resultFor("tool-output-failure");

    expect(result.runStatuses).toEqual(["failed"]);
    expect(result.specialistCalls).toBe(1);
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
  expect(result.serializedAgentRuns).not.toContain(
    "ASSEMBLED_PROMPT_CONTENT_SENTINEL",
  );
});
