import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

import { TaskNotesClient } from "../data/api/TaskNotesClient";
import { useSettingsContext } from "./SettingsContext";
import { useTaskContext } from "./TaskContext";

const HEALTH_POLL_INTERVAL = 30_000;

type SyncContextValue = {
  isConnected: boolean;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  connectionError: string | null;
  syncNow: () => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { apiUrl } = useSettingsContext();
  const { refreshTasks } = useTaskContext();
  const [isConnected, setIsConnected] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wasDisconnected = useRef(false);

  const client = useMemo(
    () => (apiUrl ? new TaskNotesClient({ baseUrl: apiUrl }) : null),
    [apiUrl],
  );

  const checkHealth = useCallback(async () => {
    if (!client) {
      setIsConnected(false);
      setConnectionError("API URL not configured");
      return;
    }
    const result = await client.health();
    if (result.ok) {
      setIsConnected(true);
      setConnectionError(null);
    } else {
      setIsConnected(false);
      setConnectionError(result.error.message);
    }
  }, [client]);

  const syncNow = useCallback(async () => {
    if (!client) return;
    setIsSyncing(true);
    try {
      await refreshTasks();
      setLastSyncTime(new Date());
    } finally {
      setIsSyncing(false);
    }
  }, [client, refreshTasks]);

  // Monitor network state
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? false;
      if (!connected) {
        wasDisconnected.current = true;
        setIsConnected(false);
      } else if (wasDisconnected.current) {
        wasDisconnected.current = false;
        void checkHealth();
        void syncNow();
      }
    });
    return () => unsubscribe();
  }, [checkHealth, syncNow]);

  // Poll health endpoint
  useEffect(() => {
    if (!client) return;
    void checkHealth();
    const interval = setInterval(() => void checkHealth(), HEALTH_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [client, checkHealth]);

  const value = useMemo<SyncContextValue>(
    () => ({
      isConnected,
      isSyncing,
      lastSyncTime,
      connectionError,
      syncNow,
    }),
    [isConnected, isSyncing, lastSyncTime, connectionError, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncContext(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error("useSyncContext must be used within SyncProvider");
  return context;
}
