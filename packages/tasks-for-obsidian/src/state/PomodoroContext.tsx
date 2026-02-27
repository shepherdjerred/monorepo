import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { AppError } from "../domain/errors";
import { ConnectionError } from "../domain/errors";
import type { Result } from "../domain/result";
import { err } from "../domain/result";
import type { PomodoroStatus, TaskId } from "../domain/types";
import { useApiClient } from "./ApiClientContext";

type PomodoroContextValue = {
  status: PomodoroStatus | null;
  startPomodoro: (taskId: TaskId) => Promise<Result<void, AppError>>;
  stopPomodoro: () => Promise<Result<void, AppError>>;
  pausePomodoro: () => Promise<Result<void, AppError>>;
  refreshStatus: () => Promise<void>;
};

const PomodoroContext = createContext<PomodoroContextValue | null>(null);

export function PomodoroProvider({ children }: { children: React.ReactNode }) {
  const client = useApiClient();
  const [status, setStatus] = useState<PomodoroStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!client) return;
    const result = await client.getPomodoroStatus();
    if (result.ok) {
      setStatus(result.value);
    }
  }, [client]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const startPomodoro = useCallback(
    async (taskId: TaskId): Promise<Result<void, AppError>> => {
      if (!client) return err(new ConnectionError("API URL not configured"));
      const result = await client.startPomodoro(taskId);
      if (result.ok) {
        setStatus(result.value);
      }
      return result.ok ? { ok: true, value: undefined } : result;
    },
    [client],
  );

  const stopPomodoro = useCallback(async (): Promise<Result<void, AppError>> => {
    if (!client) return err(new ConnectionError("API URL not configured"));
    const result = await client.stopPomodoro();
    if (result.ok) {
      setStatus(result.value);
    }
    return result.ok ? { ok: true, value: undefined } : result;
  }, [client]);

  const pausePomodoro = useCallback(async (): Promise<Result<void, AppError>> => {
    if (!client) return err(new ConnectionError("API URL not configured"));
    const result = await client.pausePomodoro();
    if (result.ok) {
      setStatus(result.value);
    }
    return result.ok ? { ok: true, value: undefined } : result;
  }, [client]);

  const value = useMemo<PomodoroContextValue>(
    () => ({
      status,
      startPomodoro,
      stopPomodoro,
      pausePomodoro,
      refreshStatus,
    }),
    [status, startPomodoro, stopPomodoro, pausePomodoro, refreshStatus],
  );

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>;
}

export function usePomodoroContext(): PomodoroContextValue {
  const context = useContext(PomodoroContext);
  if (!context) throw new Error("usePomodoroContext must be used within PomodoroProvider");
  return context;
}
