import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type { Session, CreateSessionRequest } from "../types/generated";
import { ClauderonClient } from "../api/ClauderonClient";
import type { SessionEvent } from "../api/EventsClient";
import { EventsClient } from "../api/EventsClient";
import { useSettings } from "../hooks/use-settings";
import { useSessionEvents } from "../hooks/use-session-events";

type SessionContextValue = {
  sessions: Map<string, Session>;
  isLoading: boolean;
  error: Error | null;
  client: ClauderonClient | null;
  createSession: (request: CreateSessionRequest) => Promise<string | null>;
  deleteSession: (id: string) => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  unarchiveSession: (id: string) => Promise<void>;
  refreshSession: (id: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { daemonUrl } = useSettings();
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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
    const client_ = new EventsClient({ url: wsUrl });
    client_.connect();
    return client_;
  }, [daemonUrl]);

  // Handle session events
  const handleEvent = useCallback((event: SessionEvent) => {
    setSessions((prev) => {
      const next = new Map(prev);
      switch (event.type) {
        case "SessionCreated":
        case "SessionUpdated": {
          // Event payload contains the full session object
          const session = event.payload;
          next.set(session.id, session);
          break;
        }
        case "SessionDeleted": {
          // Event payload contains { id: string }
          const payload = event.payload;
          next.delete(payload.id);
          break;
        }
        case "StatusChanged":
        case "SessionProgress":
        case "SessionFailed": {
          // These events don't require map updates
          break;
        }
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
    } catch (error_) {
      setError(error_ instanceof Error ? error_ : new Error("Failed to load sessions"));
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
        setError(new Error("No daemon URL configured"));
        return null;
      }

      try {
        const result = await client.createSession(request);
        return result.id;
      } catch (error_) {
        setError(error_ instanceof Error ? error_ : new Error("Failed to create session"));
        return null;
      }
    },
    [client],
  );

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      if (!client) {
        throw new Error("No daemon URL configured");
      }

      try {
        await client.deleteSession(id);
      } catch (error_) {
        setError(error_ instanceof Error ? error_ : new Error("Failed to delete session"));
        throw error_;
      }
    },
    [client],
  );

  const archiveSession = useCallback(
    async (id: string): Promise<void> => {
      if (!client) {
        throw new Error("No daemon URL configured");
      }

      try {
        await client.archiveSession(id);
      } catch (error_) {
        setError(error_ instanceof Error ? error_ : new Error("Failed to archive session"));
        throw error_;
      }
    },
    [client],
  );

  const unarchiveSession = useCallback(
    async (id: string): Promise<void> => {
      if (!client) {
        throw new Error("No daemon URL configured");
      }

      try {
        await client.unarchiveSession(id);
      } catch (error_) {
        setError(error_ instanceof Error ? error_ : new Error("Failed to unarchive session"));
        throw error_;
      }
    },
    [client],
  );

  const refreshSession = useCallback(
    async (id: string): Promise<void> => {
      if (!client) {
        throw new Error("No daemon URL configured");
      }

      try {
        await client.refreshSession(id);
      } catch (error_) {
        setError(error_ instanceof Error ? error_ : new Error("Failed to refresh session"));
        throw error_;
      }
    },
    [client],
  );

  const value: SessionContextValue = {
    sessions,
    isLoading,
    error,
    client,
    createSession,
    deleteSession,
    archiveSession,
    unarchiveSession,
    refreshSession,
    refreshSessions,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return context;
}
