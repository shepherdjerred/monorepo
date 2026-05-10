import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { AppError } from "../domain/errors";
import type { Result } from "../domain/result";
import { err } from "../domain/result";
import { ConnectionError } from "../domain/errors";
import { getNextStatus } from "../domain/status";
import { isRecurring, nextOptimistic } from "../domain/recurrence";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../domain/types";
import { syncWidgetData } from "../native/sync-widget";
import { useApiClient } from "./ApiClientContext";

type TaskContextValue = {
  tasks: Map<TaskId, Task>;
  isLoading: boolean;
  error: AppError | null;
  createTask: (req: CreateTaskRequest) => Promise<Result<Task, AppError>>;
  updateTask: (
    id: TaskId,
    req: UpdateTaskRequest,
  ) => Promise<Result<Task, AppError>>;
  deleteTask: (id: TaskId) => Promise<Result<void, AppError>>;
  toggleStatus: (id: TaskId) => Promise<Result<Task, AppError>>;
  refreshTasks: () => Promise<void>;
};

const TaskContext = createContext<TaskContextValue | null>(null);

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const client = useApiClient();
  const [tasks, setTasks] = useState(new Map<TaskId, Task>());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const refreshTasks = useCallback(async () => {
    if (!client) return;
    setIsLoading(true);
    setError(null);
    const result = await client.listTasks();
    if (result.ok) {
      const map = new Map<TaskId, Task>();
      for (const task of result.value) {
        map.set(task.id, task);
      }
      setTasks(map);
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  }, [client]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  useEffect(() => {
    syncWidgetData(tasks);
  }, [tasks]);

  const createTask = useCallback(
    async (req: CreateTaskRequest): Promise<Result<Task, AppError>> => {
      if (!client) return err(new ConnectionError("API URL not configured"));
      const result = await client.createTask(req);
      if (result.ok) {
        setTasks((prev) => {
          const next = new Map(prev);
          next.set(result.value.id, result.value);
          return next;
        });
      }
      return result;
    },
    [client],
  );

  const updateTask = useCallback(
    async (
      id: TaskId,
      req: UpdateTaskRequest,
    ): Promise<Result<Task, AppError>> => {
      if (!client) return err(new ConnectionError("API URL not configured"));
      const result = await client.updateTask(id, req);
      if (result.ok) {
        setTasks((prev) => {
          const next = new Map(prev);
          next.set(result.value.id, result.value);
          return next;
        });
      }
      return result;
    },
    [client],
  );

  const deleteTask = useCallback(
    async (id: TaskId): Promise<Result<void, AppError>> => {
      if (!client) return err(new ConnectionError("API URL not configured"));
      const result = await client.deleteTask(id);
      if (result.ok) {
        setTasks((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
      return result;
    },
    [client],
  );

  const toggleStatus = useCallback(
    async (id: TaskId): Promise<Result<Task, AppError>> => {
      if (!client) return err(new ConnectionError("API URL not configured"));
      const existing = tasks.get(id);
      if (!existing) return err(new ConnectionError("Task not found"));
      const optimistic = nextOptimistic(existing);
      setTasks((prev) => {
        const next = new Map(prev);
        next.set(id, optimistic);
        return next;
      });
      const result = isRecurring(existing)
        ? await client.completeRecurringInstance(id)
        : await client.toggleTaskStatus(id, getNextStatus(existing.status));
      if (result.ok) {
        setTasks((prev) => {
          const next = new Map(prev);
          next.set(result.value.id, result.value);
          return next;
        });
      } else {
        setTasks((prev) => {
          const next = new Map(prev);
          next.set(id, existing);
          return next;
        });
      }
      return result;
    },
    [client, tasks],
  );

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks,
      isLoading,
      error,
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
