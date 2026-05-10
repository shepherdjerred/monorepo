import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AppError } from "../domain/errors";
import type { Result } from "../domain/result";
import { OK_VOID, err, ok } from "../domain/result";
import { ConnectionError } from "../domain/errors";
import { getNextStatus } from "../domain/status";
import { isRecurring, nextOptimistic } from "../domain/recurrence";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../domain/types";
import { contextName, projectName, tagName, taskId } from "../domain/types";
import { syncWidgetData } from "../native/sync-widget";
import { MutationQueue } from "../data/sync/MutationQueue";
import { SyncEngine } from "../data/sync/SyncEngine";
import { TypedStorage } from "../data/cache/storage";
import { useApiClient } from "./ApiClientContext";

type TaskContextValue = {
  tasks: Map<TaskId, Task>;
  isLoading: boolean;
  error: AppError | null;
  pendingMutationCount: number;
  createTask: (req: CreateTaskRequest) => Promise<Result<Task, AppError>>;
  updateTask: (
    id: TaskId,
    req: UpdateTaskRequest,
  ) => Promise<Result<Task, AppError>>;
  deleteTask: (id: TaskId) => Promise<Result<void, AppError>>;
  toggleStatus: (id: TaskId) => Promise<Result<Task, AppError>>;
  refreshTasks: () => Promise<Result<void, AppError>>;
};

const TaskContext = createContext<TaskContextValue | null>(null);

let tempCounter = 0;
function generateTempId(): TaskId {
  tempCounter += 1;
  return taskId(`tmp-${String(Date.now())}-${String(tempCounter)}`);
}

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const client = useApiClient();
  const [tasks, setTasks] = useState(new Map<TaskId, Task>());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [pendingMutationCount, setPendingMutationCount] = useState(0);

  const mutationQueueRef = useRef<MutationQueue | null>(null);
  mutationQueueRef.current ??= new MutationQueue();
  const mutationQueue = mutationQueueRef.current;

  const updatePendingCount = useCallback(() => {
    setPendingMutationCount(mutationQueue.pending.length);
  }, [mutationQueue]);

  const setTasksFromArray = useCallback((list: Task[]) => {
    const map = new Map<TaskId, Task>();
    for (const t of list) {
      map.set(t.id, t);
    }
    setTasks(map);
  }, []);

  const syncEngine = useMemo(
    () =>
      client === null
        ? null
        : new SyncEngine(client, mutationQueue, setTasksFromArray),
    [client, mutationQueue, setTasksFromArray],
  );

  // Restore queue + cached tasks once on mount. React 18+ silently drops
  // setState calls on unmounted components, so no cancellation flag needed.
  useEffect(() => {
    void (async () => {
      await mutationQueue.restore();
      updatePendingCount();
      const cached = await TypedStorage.getTasks();
      if (cached.length > 0) {
        setTasksFromArray(cached);
      }
    })();
  }, [mutationQueue, setTasksFromArray, updatePendingCount]);

  const refreshTasks = useCallback(async (): Promise<
    Result<void, AppError>
  > => {
    if (syncEngine === null) {
      return err(new ConnectionError("API URL not configured"));
    }
    setIsLoading(true);
    setError(null);
    const result = await syncEngine.fullSync();
    if (!result.ok) {
      setError(result.error);
    }
    updatePendingCount();
    setIsLoading(false);
    return result;
  }, [syncEngine, updatePendingCount]);

  // Initial load when client becomes available.
  useEffect(() => {
    if (syncEngine === null) return;
    void refreshTasks();
  }, [syncEngine, refreshTasks]);

  useEffect(() => {
    syncWidgetData(tasks);
  }, [tasks]);

  const replayInBackground = useCallback(() => {
    if (client === null) return;
    void (async () => {
      await mutationQueue.replay(client);
      updatePendingCount();
    })();
  }, [client, mutationQueue, updatePendingCount]);

  const createTask = useCallback(
    async (req: CreateTaskRequest): Promise<Result<Task, AppError>> => {
      if (client === null) {
        return err(new ConnectionError("API URL not configured"));
      }
      const tempId = generateTempId();
      const now = new Date().toISOString();
      const optimistic: Task = {
        id: tempId,
        path: "",
        title: req.title,
        status: req.status ?? "open",
        priority: req.priority ?? "normal",
        due: req.due,
        scheduled: req.scheduled,
        contexts:
          req.contexts === undefined
            ? []
            : req.contexts.map((c) => contextName(c)),
        projects:
          req.projects === undefined
            ? []
            : req.projects.map((p) => projectName(p)),
        tags: req.tags === undefined ? [] : req.tags.map((t) => tagName(t)),
        recurrence: req.recurrence,
        recurrenceAnchor: req.recurrenceAnchor,
        completeInstances: [],
        skippedInstances: [],
        timeEntries: [],
        blockedBy: [],
        reminders: [],
        archived: false,
        totalTrackedTime: 0,
        isBlocked: false,
        isBlocking: false,
        extraFields: req.extraFields ?? {},
        details: req.details,
        dateCreated: now,
        dateModified: now,
      };
      setTasks((prev) => {
        const next = new Map(prev);
        next.set(tempId, optimistic);
        return next;
      });
      await mutationQueue.enqueue({ type: "create", payload: req });
      updatePendingCount();
      const result = await client.createTask(req);
      if (result.ok) {
        setTasks((prev) => {
          const next = new Map(prev);
          next.delete(tempId);
          next.set(result.value.id, result.value);
          return next;
        });
        await mutationQueue.replay(client);
        updatePendingCount();
        return result;
      }
      // Server unreachable: optimistic task with temp ID stays; mutation stays queued.
      return ok(optimistic);
    },
    [client, mutationQueue, updatePendingCount],
  );

  const updateTask = useCallback(
    async (
      id: TaskId,
      req: UpdateTaskRequest,
    ): Promise<Result<Task, AppError>> => {
      if (client === null) {
        return err(new ConnectionError("API URL not configured"));
      }
      const existing = tasks.get(id);
      if (existing === undefined) {
        return err(new ConnectionError("Task not found"));
      }
      const updates: Partial<Task> = {};
      for (const [key, value] of Object.entries(req)) {
        if (value !== undefined) {
          Object.assign(updates, { [key]: value });
        }
      }
      const optimistic: Task = { ...existing, ...updates };
      setTasks((prev) => {
        const next = new Map(prev);
        next.set(id, optimistic);
        return next;
      });
      await mutationQueue.enqueue({ type: "update", taskId: id, payload: req });
      updatePendingCount();
      const result = await client.updateTask(id, req);
      if (result.ok) {
        setTasks((prev) => {
          const next = new Map(prev);
          next.set(result.value.id, result.value);
          return next;
        });
        await mutationQueue.replay(client);
        updatePendingCount();
        return result;
      }
      return ok(optimistic);
    },
    [client, mutationQueue, tasks, updatePendingCount],
  );

  const deleteTask = useCallback(
    async (id: TaskId): Promise<Result<void, AppError>> => {
      if (client === null) {
        return err(new ConnectionError("API URL not configured"));
      }
      setTasks((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      await mutationQueue.enqueue({ type: "delete", taskId: id });
      updatePendingCount();
      const result = await client.deleteTask(id);
      if (result.ok) {
        await mutationQueue.replay(client);
        updatePendingCount();
        return result;
      }
      return OK_VOID;
    },
    [client, mutationQueue, updatePendingCount],
  );

  const toggleStatus = useCallback(
    async (id: TaskId): Promise<Result<Task, AppError>> => {
      if (client === null) {
        return err(new ConnectionError("API URL not configured"));
      }
      const existing = tasks.get(id);
      if (existing === undefined) {
        return err(new ConnectionError("Task not found"));
      }
      const optimistic = nextOptimistic(existing);
      setTasks((prev) => {
        const next = new Map(prev);
        next.set(id, optimistic);
        return next;
      });
      if (isRecurring(existing)) {
        await mutationQueue.enqueue({ type: "complete_instance", taskId: id });
      } else {
        const newStatus = getNextStatus(existing.status);
        await mutationQueue.enqueue({
          type: "toggle_status",
          taskId: id,
          payload: { status: newStatus },
        });
      }
      updatePendingCount();
      const result = isRecurring(existing)
        ? await client.completeRecurringInstance(id)
        : await client.toggleTaskStatus(id, getNextStatus(existing.status));
      if (result.ok) {
        setTasks((prev) => {
          const next = new Map(prev);
          next.set(result.value.id, result.value);
          return next;
        });
        await mutationQueue.replay(client);
        updatePendingCount();
        return result;
      }
      return ok(optimistic);
    },
    [client, mutationQueue, tasks, updatePendingCount],
  );

  // Replay queue on every client change (e.g., URL configured).
  useEffect(() => {
    replayInBackground();
  }, [replayInBackground]);

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks,
      isLoading,
      error,
      pendingMutationCount,
      createTask,
      updateTask,
      deleteTask,
      toggleStatus,
      refreshTasks,
    }),
    [
      tasks,
      isLoading,
      error,
      pendingMutationCount,
      createTask,
      updateTask,
      deleteTask,
      toggleStatus,
      refreshTasks,
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
