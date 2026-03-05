import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { AppError } from "../domain/errors";
import { ConnectionError } from "../domain/errors";
import type { Result } from "../domain/result";
import { err } from "../domain/result";
import type { TaskId, TimeEntry, TimeSummary } from "../domain/types";
import { useApiClient } from "./ApiClientContext";

type TimeTrackingContextValue = {
  activeEntry: TimeEntry | null;
  startTracking: (taskId: TaskId) => Promise<Result<void, AppError>>;
  stopTracking: (taskId: TaskId) => Promise<Result<void, AppError>>;
  getTaskTime: (taskId: TaskId) => Promise<Result<TimeSummary, AppError>>;
};

const TimeTrackingContext = createContext<TimeTrackingContextValue | null>(
  null,
);

export function TimeTrackingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = useApiClient();
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);

  const startTracking = useCallback(
    async (taskId: TaskId): Promise<Result<void, AppError>> => {
      if (!client) return err(new ConnectionError("API URL not configured"));
      const result = await client.startTimeTracking(taskId);
      if (result.ok) {
        setActiveEntry({
          taskId,
          startTime: new Date().toISOString(),
        });
      }
      return result;
    },
    [client],
  );

  const stopTracking = useCallback(
    async (taskId: TaskId): Promise<Result<void, AppError>> => {
      if (!client) return err(new ConnectionError("API URL not configured"));
      const result = await client.stopTimeTracking(taskId);
      if (result.ok) {
        setActiveEntry(null);
      }
      return result;
    },
    [client],
  );

  const getTaskTime = useCallback(
    async (taskId: TaskId): Promise<Result<TimeSummary, AppError>> => {
      if (!client) return err(new ConnectionError("API URL not configured"));
      return client.getTaskTime(taskId);
    },
    [client],
  );

  const value = useMemo<TimeTrackingContextValue>(
    () => ({
      activeEntry,
      startTracking,
      stopTracking,
      getTaskTime,
    }),
    [activeEntry, startTracking, stopTracking, getTaskTime],
  );

  return (
    <TimeTrackingContext.Provider value={value}>
      {children}
    </TimeTrackingContext.Provider>
  );
}

export function useTimeTrackingContext(): TimeTrackingContextValue {
  const context = useContext(TimeTrackingContext);
  if (!context)
    throw new Error(
      "useTimeTrackingContext must be used within TimeTrackingProvider",
    );
  return context;
}
