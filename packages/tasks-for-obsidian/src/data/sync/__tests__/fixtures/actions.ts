import type { AppError } from "../../../../domain/errors";
import type { Result } from "../../../../domain/result";
import type { Task } from "../../../../domain/types";
import type { MutationOptions } from "../../SyncEngine";
import { makeClock, makeHarness, makeTask } from "../harness";
import { deserializeAppError } from "./errors";
import type {
  FixtureAction,
  FixtureClientCall,
  Scenario,
} from "./schema";
import type { RunState } from "./world";
import { actionTaskId, captureView, resolveTime, taskOverrides } from "./world";

/**
 * The seventeen scenario verbs.
 *
 * `runAction` returns a promise ONLY for genuinely asynchronous verbs, so
 * synchronous ones never introduce a microtask boundary the original tests
 * did not have. That matters: the reconnect scenario fires a retry timer, a
 * foreground trigger and a manual sync inside one turn, and awaiting between
 * them would quietly unwind the pile-up it exists to pin.
 */

function bindResult(
  state: RunState,
  name: string | undefined,
  result: Result<unknown, AppError>,
): void {
  if (name !== undefined) state.results.set(name, result);
}

function callOptions(call: FixtureClientCall): MutationOptions | undefined {
  if (call.method === "listTasks") return undefined;
  return call.mutationId === undefined
    ? undefined
    : { mutationId: call.mutationId };
}

async function runClientCall(
  state: RunState,
  action: Extract<FixtureAction, { kind: "client_call" }>,
): Promise<void> {
  const { server } = state.harness;
  const call = action.call;
  const options = callOptions(call);
  switch (call.method) {
    case "listTasks":
      bindResult(state, action.as, await server.listTasks());
      return;
    case "createTask":
      bindResult(
        state,
        action.as,
        await server.createTask(call.request, options),
      );
      return;
    case "updateTask":
      bindResult(
        state,
        action.as,
        await server.updateTask(
          actionTaskId(state, call.task),
          call.request,
          options,
        ),
      );
      return;
    case "deleteTask":
      bindResult(
        state,
        action.as,
        await server.deleteTask(actionTaskId(state, call.task), options),
      );
      return;
    case "toggleTaskStatus":
      bindResult(
        state,
        action.as,
        await server.toggleTaskStatus(
          actionTaskId(state, call.task),
          call.status,
          options,
        ),
      );
      return;
    case "completeRecurringInstance":
      bindResult(
        state,
        action.as,
        await server.completeRecurringInstance(
          actionTaskId(state, call.task),
          call.instance ?? undefined,
          options,
        ),
      );
  }
}

async function runDispatch(
  state: RunState,
  action: Extract<FixtureAction, { kind: "dispatch" }>,
): Promise<void> {
  const { store } = state.harness;
  const input = action.input;
  let task: Task | undefined;
  switch (input.type) {
    case "create":
      task = await store.dispatch({ type: "create", payload: input.payload });
      break;
    case "update":
      task = await store.dispatch({
        type: "update",
        taskId: actionTaskId(state, input.task),
        payload: input.payload,
      });
      break;
    case "delete":
      task = await store.dispatch({
        type: "delete",
        taskId: actionTaskId(state, input.task),
      });
      break;
    case "set_status":
      task = await store.dispatch({
        type: "set_status",
        taskId: actionTaskId(state, input.task),
        status: input.status,
      });
      break;
    case "set_instance_complete":
      task = await store.dispatch({
        type: "set_instance_complete",
        taskId: actionTaskId(state, input.task),
        date: input.date,
        completed: input.completed,
      });
      break;
  }
  if (action.as === undefined) return;
  if (task === undefined) {
    throw new Error(
      `dispatch bound to "${action.as}" produced no optimistic task`,
    );
  }
  state.taskIds.set(action.as, task.id);
}

async function runSyncNow(
  state: RunState,
  action: Extract<FixtureAction, { kind: "sync_now" }>,
): Promise<void> {
  bindResult(state, action.as, await state.harness.engine.syncNow());
}

function relaunch(state: RunState, from: string): void {
  const record = state.snapshots.get(from);
  if (record === undefined) throw new Error(`unknown snapshot "${from}"`);
  // Only the client is rebuilt. The clock and the fake server survive — the
  // server is what remembers which mutation ids it already applied, which is
  // the whole point of relaunching against a deliberately stale queue.
  state.harness = makeHarness({
    clock: state.harness.clock,
    server: state.harness.server,
    queueStorage: record.queueStorage.clone(),
    storeStorage: record.storeStorage.clone(),
    autoSync: state.autoSync,
  });
}

function runAction(
  state: RunState,
  action: FixtureAction,
): Promise<void> | undefined {
  const harness = state.harness;
  switch (action.kind) {
    case "store_restore":
      return harness.store.restore();
    case "server_seed":
      harness.server.seed(
        ...action.tasks.map((fields) => makeTask(taskOverrides(fields))),
      );
      return undefined;
    case "server_offline":
      harness.server.goOffline();
      return undefined;
    case "server_online":
      harness.server.goOnline();
      return undefined;
    case "server_fail_next":
      harness.server.failNext(action.method, deserializeAppError(action.error));
      return undefined;
    case "server_inject_edit":
      harness.server.injectServerEdit(
        actionTaskId(state, action.task),
        taskOverrides(action.patch),
      );
      return undefined;
    case "clock_set":
      harness.clock.set(resolveTime(action.at));
      return undefined;
    case "dispatch":
      return runDispatch(state, action);
    case "sync_now":
      return runSyncNow(state, action);
    case "request_sync":
      harness.engine.requestSync();
      return undefined;
    case "scheduler_fire_next":
      harness.scheduler.fireNext();
      return undefined;
    case "engine_dispose":
      harness.engine.dispose();
      return undefined;
    case "retry_dead_letter": {
      const entry = harness.store.getSnapshot().deadLetters[action.index];
      if (entry === undefined) {
        throw new Error(`no dead letter at index ${String(action.index)}`);
      }
      return harness.store.retryDeadLetter(entry.command.id);
    }
    case "client_call":
      return runClientCall(state, action);
    case "snapshot":
      state.snapshots.set(action.as, {
        queueStorage: harness.queueStorage.clone(),
        storeStorage: harness.storeStorage.clone(),
        view: captureView(harness),
      });
      return undefined;
    case "relaunch":
      relaunch(state, action.from);
      return undefined;
    case "settle":
      return Promise.resolve();
  }
}

/** Build a fresh world and run every action of a scenario in order. */
export async function runActions(scenario: Scenario): Promise<RunState> {
  const autoSync = scenario.setup.autoSync ?? false;
  const clock =
    scenario.setup.clock === undefined
      ? makeClock()
      : makeClock(resolveTime(scenario.setup.clock));
  const state: RunState = {
    harness: makeHarness({ clock, autoSync }),
    autoSync,
    results: new Map(),
    taskIds: new Map(),
    snapshots: new Map(),
  };
  for (const action of scenario.actions) {
    const pending = runAction(state, action);
    if (pending !== undefined) await pending;
  }
  return state;
}
