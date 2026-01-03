import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type {
  Session,
  CreateSessionRequest,
  AccessMode,
} from "../types/generated";
import { ClauderonClient } from "../api/ClauderonClient";
import type { SessionEvent } from "../api/EventsClient";
import { EventsClient } from "../api/EventsClient";
import { useSettings } from "../hooks/useSettings";
import { useSessionEvents } from "../hooks/useSessionEvents";

type SessionContextValue = {
  sessions: Map<string, Session>;
  isLoading: boolean;
  error: string | null;
  client: ClauderonClient | null;
  createSession: (request: CreateSessionRequest) => Promise<string | null>;
  deleteSession: (id: string) => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  updateAccessMode: (id: string, mode: AccessMode) => Promise<void>;
  refreshSessions: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { daemonUrl } = useSettings();
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create clients
  const client = useMemo(() => {
    if (!daemonUrl) {
      return null;
    }
    return new ClauderonClient({ baseUrl: daemonUrl });
  }, [daemonUrl]);

  const eventsClient = useMemo(() => {
    if (!daemonUrl) {
      return null;
    }
    const wsUrl = daemonUrl.replace(/^http/, "ws") + "/ws/events";
    const eventsClient = new EventsClient({ url: wsUrl });
    eventsClient.connect();
    return eventsClient;
  }, [daemonUrl]);

  // Handle session events
  const handleEvent = useCallback((event: SessionEvent) => {
    setSessions((prev) => {
      const next = new Map(prev);
      switch (event.type) {
        case "session_created":
        case "session_updated":
          next.set(event.session.id, event.session);
          break;
        case "session_deleted":
          next.delete(event.sessionId);
          break;
      }
      return next;
    });
  }, []);

  useSessionEvents(eventsClient, handleEvent);

  // Load sessions on mount or when client changes
  const refreshSessions = useCallback(async () => {
    if (!client) {
      setSessions(new Map());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const sessionList = await client.listSessions();
      const sessionMap = new Map<string, Session>();
      for (const session of sessionList) {
        sessionMap.set(session.id, session);
      }
      setSessions(sessionMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Clean up events client on unmount
  useEffect(() => {
    return () => {
      if (eventsClient) {
        eventsClient.dispose();
      }
    };
  }, [eventsClient]);

  const createSession = useCallback(
    async (request: CreateSessionRequest): Promise<string | null> => {
      if (!client) {
        setError("No daemon URL configured");
        return null;
      }

      try {
        const result = await client.createSession(request);
        return result.id;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create session");
        return null;
      }
    },
    [client]
  );

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      if (!client) {
        throw new Error("No daemon URL configured");
      }

      try {
        await client.deleteSession(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete session");
        throw err;
      }
    },
    [client]
  );

  const archiveSession = useCallback(
    async (id: string): Promise<void> => {
      if (!client) {
        throw new Error("No daemon URL configured");
      }

      try {
        await client.archiveSession(id);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to archive session"
        );
        throw err;
      }
    },
    [client]
  );

  const updateAccessMode = useCallback(
    async (id: string, mode: AccessMode): Promise<void> => {
      if (!client) {
        throw new Error("No daemon URL configured");
      }

      try {
        await client.updateAccessMode(id, mode);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update access mode"
        );
        throw err;
      }
    },
    [client]
  );

  const value: SessionContextValue = {
    sessions,
    isLoading,
    error,
    client,
    createSession,
    deleteSession,
    archiveSession,
    updateAccessMode,
    refreshSessions,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return context;
}
