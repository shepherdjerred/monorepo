import { expect } from "bun:test";

import { isTempId } from "../../commands";
import { runActions } from "./actions";
import type { FixtureAssertion, Scenario } from "./schema";
import type { RunState } from "./world";
import {
  boundResult,
  callLogField,
  captureView,
  countOf,
  endStateDigest,
  findByTitle,
  readPath,
  resolveTaskRef,
  resolveTime,
  tasksOf,
  viewAt,
} from "./world";

/**
 * The seventeen assertion kinds.
 *
 * Assertions are declarative and run after every action. To assert on a
 * mid-flight state, a scenario takes a `snapshot` at that moment and points
 * the assertion at it with `at`.
 */

/** `expect` with both sides widened, so `unknown` comparands are legal. */
function expectEquals(actual: unknown, expected: unknown): void {
  expect<unknown>(actual).toEqual(expected);
}

function expectIs(actual: unknown, expected: unknown): void {
  expect<unknown>(actual).toBe(expected);
}

function checkResult(
  state: RunState,
  assertion: Extract<
    FixtureAssertion,
    { kind: "result" | "result_field" | "results_field_equal" }
  >,
): void {
  switch (assertion.kind) {
    case "result": {
      const result = boundResult(state, assertion.ref);
      expectIs(result.ok, assertion.ok);
      if (assertion.errorKind !== undefined) {
        if (result.ok) throw new Error("expected a failed result");
        expectIs(result.error.kind, assertion.errorKind);
      }
      return;
    }
    case "result_field":
      expectEquals(
        readPath(boundResult(state, assertion.ref), assertion.path),
        assertion.equals,
      );
      return;
    case "results_field_equal": {
      const [left, right] = assertion.refs;
      expectEquals(
        readPath(boundResult(state, left), assertion.path),
        readPath(boundResult(state, right), assertion.path),
      );
    }
  }
}

function checkTasks(
  state: RunState,
  assertion: Extract<
    FixtureAssertion,
    { kind: "task_count" | "task_field" | "task_exists" | "task_id_is_temp" }
  >,
): void {
  switch (assertion.kind) {
    case "task_count":
      expectIs(
        tasksOf(viewAt(state, assertion.at), assertion.source).size,
        countOf(
          state,
          assertion.equals,
          (other) => tasksOf(other, assertion.source).size,
        ),
      );
      return;
    case "task_field": {
      const tasks = tasksOf(viewAt(state, assertion.at), assertion.source);
      const id = resolveTaskRef(state, assertion.task, tasks);
      const task = tasks.get(id);
      if (task === undefined) {
        throw new Error(`no ${assertion.source} task ${String(id)}`);
      }
      expectEquals(readPath(task, assertion.path), assertion.equals);
      return;
    }
    case "task_exists": {
      const tasks = tasksOf(viewAt(state, assertion.at), assertion.source);
      const present =
        assertion.task.by === "title"
          ? findByTitle(tasks, assertion.task.value) !== undefined
          : tasks.has(resolveTaskRef(state, assertion.task, tasks));
      expectIs(present, assertion.exists);
      return;
    }
    case "task_id_is_temp": {
      const id = resolveTaskRef(
        state,
        assertion.task,
        state.harness.store.getSnapshot().tasks,
      );
      expectIs(isTempId(id), assertion.equals);
    }
  }
}

function checkQueue(
  state: RunState,
  assertion: Extract<
    FixtureAssertion,
    {
      kind:
        | "pending_count"
        | "queue_pending_equals"
        | "dead_letter_count"
        | "dead_letter_field";
    }
  >,
): void {
  switch (assertion.kind) {
    case "pending_count":
      expectIs(
        viewAt(state, assertion.at).pendingCount,
        countOf(state, assertion.equals, (other) => other.pendingCount),
      );
      return;
    case "queue_pending_equals":
      expectEquals(
        captureView(state.harness).pendingCommands,
        viewAt(state, assertion.at).pendingCommands,
      );
      return;
    case "dead_letter_count":
      expect(viewAt(state, assertion.at).deadLetters).toHaveLength(
        assertion.equals,
      );
      return;
    case "dead_letter_field": {
      const entry = viewAt(state, assertion.at).deadLetters[assertion.index];
      if (entry === undefined) {
        throw new Error(`no dead letter at index ${String(assertion.index)}`);
      }
      expectEquals(readPath(entry, assertion.path), assertion.equals);
    }
  }
}

function checkEngine(
  state: RunState,
  assertion: Extract<
    FixtureAssertion,
    {
      kind:
        | "last_sync_time"
        | "engine_state"
        | "scheduler_pending"
        | "call_count"
        | "call_log";
    }
  >,
): void {
  switch (assertion.kind) {
    case "last_sync_time":
      expectIs(
        viewAt(state, assertion.at).lastSyncTime,
        assertion.equals === null ? null : resolveTime(assertion.equals),
      );
      return;
    case "engine_state":
      expectIs(viewAt(state, assertion.at).engineState, assertion.equals);
      return;
    case "scheduler_pending": {
      const delays = viewAt(state, assertion.at).schedulerDelays;
      if (assertion.count !== undefined) {
        expect(delays).toHaveLength(assertion.count);
      }
      if (assertion.delays !== undefined) expectEquals(delays, assertion.delays);
      return;
    }
    case "call_count": {
      const calls = viewAt(state, assertion.at).serverCalls.filter(
        (call) =>
          call.method === assertion.method &&
          (assertion.applied !== true || call.applied),
      );
      expect(calls).toHaveLength(assertion.equals);
      return;
    }
    case "call_log": {
      const calls = viewAt(state, assertion.at).serverCalls;
      if (assertion.index === undefined) {
        expectEquals(
          calls.map((call) => callLogField(call, assertion.field)),
          assertion.equals,
        );
        return;
      }
      const call = calls[assertion.index];
      if (call === undefined) {
        throw new Error(`no call at index ${String(assertion.index)}`);
      }
      expectEquals(callLogField(call, assertion.field), assertion.equals);
    }
  }
}

async function evaluate(
  scenario: Scenario,
  state: RunState,
  assertion: FixtureAssertion,
): Promise<void> {
  switch (assertion.kind) {
    case "result":
    case "result_field":
    case "results_field_equal":
      checkResult(state, assertion);
      return;
    case "task_count":
    case "task_field":
    case "task_exists":
    case "task_id_is_temp":
      checkTasks(state, assertion);
      return;
    case "pending_count":
    case "queue_pending_equals":
    case "dead_letter_count":
    case "dead_letter_field":
      checkQueue(state, assertion);
      return;
    case "last_sync_time":
    case "engine_state":
    case "scheduler_pending":
    case "call_count":
    case "call_log":
      checkEngine(state, assertion);
      return;
    case "deterministic_end_state": {
      const replay = await runActions(scenario);
      expectEquals(endStateDigest(replay), endStateDigest(state));
    }
  }
}

/**
 * Failures name the fixture and the exact assertion. Without it a corpus of
 * 25 scenarios reports "expected 2, received 1" with no way to tell which
 * line of which JSON file meant it.
 */
export async function checkAssertion(
  scenario: Scenario,
  state: RunState,
  assertion: FixtureAssertion,
): Promise<void> {
  try {
    await evaluate(scenario, state, assertion);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${scenario.id} — ${JSON.stringify(assertion)}\n${detail}`,
      { cause: error },
    );
  }
}
