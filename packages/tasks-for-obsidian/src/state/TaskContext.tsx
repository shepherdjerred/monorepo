import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { AppError } from "../domain/errors";
import { NotFoundError } from "../domain/errors";
import type { Result } from "../domain/result";
import { OK_VOID, err, ok } from "../domain/result";
import { getNextStatus } from "../domain/status";
import { completionTargetDate, isRecurring } from "../domain/recurrence";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../domain/types";
import { syncWidgetData } from "../native/sync-widget";
import { runMigrations } from "../data/cache/migrations";
import { CommandQueue, type DeadLetterEntry } from "../data/sync/CommandQueue";
import { SyncEngine, type SyncStatus } from "../data/sync/SyncEngine";
import { TaskStore } from "../data/store/TaskStore";
import { useApiClient } from "./ApiClientContext";

/**
 * React face of the offline-first store. Every mutation is a single
 * `store.dispatch(...)` — the store persists the command, updates the view
 * optimistically, and pokes the SyncEngine. No mutation here ever calls the
 * network directly (the old enqueue + direct call + replay triple execution
 * was the root data-loss bug).
 */

type TaskContextValue = {
  tasks: ReadonlyMap<TaskId, Task>;
  isLoading: boolean;
  error: AppError | null;
  pendingMutationCount: number;
  pendingTaskIds: ReadonlySet<TaskId>;
  deadLetters: readonly DeadLetterEntry[];
  syncStatus: SyncStatus;
  lastSyncTime: number | null;
  resolveTaskId: (id: TaskId) => TaskId;
  createTask: (req: CreateTaskRequest) => Promise<Result<Task, AppError>>;
  updateTask: (
    id: TaskId,
    req: UpdateTaskRequest,
  ) => Promise<Result<Task, AppError>>;
  deleteTask: (id: TaskId) => Promise<Result<void, AppError>>;
  toggleStatus: (id: TaskId) => Promise<Result<Task, AppError>>;
  setInstanceComplete: (
    id: TaskId,
    date: string,
    completed: boolean,
  ) => Promise<Result<Task, AppError>>;
  refreshTasks: () => Promise<Result<void, AppError>>;
  retryDeadLetter: (commandId: string) => Promise<void>;
  discardDeadLetter: (commandId: string) => Promise<void>;
};

const TaskContext = createContext<TaskContextValue | null>(null);

const IDLE_STATUS: SyncStatus = {
  state: "idle",
  lastError: null,
  nextRetryAt: null,
};

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const client = useApiClient();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(IDLE_STATUS);
  const [restored, setRestored] = useState(false);

  // Queue and store live for the whole app session; only the engine is
  // rebuilt when the API client changes (URL/token edited in Settings).
  const stackRef = useRef<{ queue: CommandQueue; store: TaskStore } | null>(
    null,
  );
  if (stackRef.current === null) {
    const queue = new CommandQueue();
    stackRef.current = { queue, store: new TaskStore(queue) };
  }
  const { queue, store } = stackRef.current;

  const engine = useMemo(
    () =>
      new SyncEngine(client, queue, store, { onStatusChange: setSyncStatus }),
    [client, queue, store],
  );

  useEffect(() => {
    store.onDispatch = () => {
      engine.requestSync();
    };
    return () => {
      store.onDispatch = null;
      // The successor engine owns the queue now; a stale retry timer must
      // not drain it against the old client.
      engine.dispose();
    };
  }, [engine, store]);

  // One-time startup: migrate old storage formats, then load durable state.
  useEffect(() => {
    void (async () => {
      await runMigrations();
      await store.restore();
      setRestored(true);
    })();
  }, [store]);

  // First sync once both the durable state and a client are available.
  useEffect(() => {
    if (restored && client !== null) {
      engine.requestSync();
    }
  }, [restored, client, engine]);

  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(onChange),
    [store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    syncWidgetData(snapshot.tasks);
  }, [snapshot.tasks]);

  const createTask = useCallback(
    async (req: CreateTaskRequest): Promise<Result<Task, AppError>> => {
      const created = await store.dispatch({ type: "create", payload: req });
      if (created === undefined) {
        return err(new NotFoundError("Task", "optimistic create"));
      }
      return ok(created);
    },
    [store],
  );

  const updateTask = useCallback(
    async (
      id: TaskId,
      req: UpdateTaskRequest,
    ): Promise<Result<Task, AppError>> => {
      const target = store.resolveTaskId(id);
      if (!store.getSnapshot().tasks.has(target)) {
        return err(new NotFoundError("Task", String(id)));
      }
      const updated = await store.dispatch({
        type: "update",
        taskId: target,
        payload: req,
      });
      if (updated === undefined) {
        return err(new NotFoundError("Task", String(id)));
      }
      return ok(updated);
    },
    [store],
  );

  const deleteTask = useCallback(
    async (id: TaskId): Promise<Result<void, AppError>> => {
      await store.dispatch({ type: "delete", taskId: id });
      return OK_VOID;
    },
    [store],
  );

  const toggleStatus = useCallback(
    async (id: TaskId): Promise<Result<Task, AppError>> => {
      const target = store.resolveTaskId(id);
      const existing = store.getSnapshot().tasks.get(target);
      if (existing === undefined) {
        return err(new NotFoundError("Task", String(id)));
      }
      // Absolute target state, computed once at tap time — replaying the
      // command later (even after midnight) applies exactly this intent.
      // Recurring completion targets the SCHEDULED occurrence (plugin parity via
      // completionTargetDate), not the literal tap day — otherwise a tap on a
      // non-occurrence day records an orphaned date the model never reads as
      // done. Capture the date once so `date` and `completed` can't straddle a
      // midnight boundary (object properties evaluate left-to-right).
      const instanceDate = completionTargetDate(existing);
      const updated = isRecurring(existing)
        ? await store.dispatch({
            type: "set_instance_complete",
            taskId: target,
            date: instanceDate,
            completed: !existing.completeInstances.includes(instanceDate),
          })
        : await store.dispatch({
            type: "set_status",
            taskId: target,
            status: getNextStatus(existing.status),
          });
      if (updated === undefined) {
        return err(new NotFoundError("Task", String(id)));
      }
      return ok(updated);
    },
    [store],
  );

  // Absolute per-instance completion — the undo path for a recurring
  // completion must resend the ORIGINAL target date with completed:false;
  // re-toggling would recompute the date (wrong after the server advances
  // `scheduled`, or after midnight).
  const setInstanceComplete = useCallback(
    async (
      id: TaskId,
      date: string,
      completed: boolean,
    ): Promise<Result<Task, AppError>> => {
      const target = store.resolveTaskId(id);
      const updated = await store.dispatch({
        type: "set_instance_complete",
        taskId: target,
        date,
        completed,
      });
      if (updated === undefined) {
        return err(new NotFoundError("Task", String(id)));
      }
      return ok(updated);
    },
    [store],
  );

  const refreshTasks = useCallback(() => engine.syncNow(), [engine]);

  const retryDeadLetter = useCallback(
    (commandId: string) => store.retryDeadLetter(commandId),
    [store],
  );

  const discardDeadLetter = useCallback(
    (commandId: string) => store.discardDeadLetter(commandId),
    [store],
  );

  const resolveTaskId = useCallback(
    (id: TaskId) => store.resolveTaskId(id),
    [store],
  );

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks: snapshot.tasks,
      isLoading: syncStatus.state === "syncing",
      error: syncStatus.lastError,
      pendingMutationCount: snapshot.pendingCount,
      pendingTaskIds: snapshot.pendingTaskIds,
      deadLetters: snapshot.deadLetters,
      syncStatus,
      lastSyncTime: snapshot.lastSyncTime,
      resolveTaskId,
      createTask,
      updateTask,
      deleteTask,
      toggleStatus,
      setInstanceComplete,
      refreshTasks,
      retryDeadLetter,
      discardDeadLetter,
    }),
    [
      snapshot,
      syncStatus,
      resolveTaskId,
      createTask,
      updateTask,
      deleteTask,
      toggleStatus,
      setInstanceComplete,
      refreshTasks,
      retryDeadLetter,
      discardDeadLetter,
    ],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTaskContext(): TaskContextValue {
  const context = useContext(TaskContext);
  if (!context)
    throw new Error("useTaskContext must be used within TaskProvider");
  return context;
}
