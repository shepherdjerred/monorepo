import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Session, CreateSessionRequest, AccessMode, SessionHealthReport } from "@clauderon/client";
import { useClauderonClient } from "../hooks/useClauderonClient";
import { useSessionEvents } from "../hooks/useSessionEvents";
import type { ClauderonClient } from "@clauderon/client";

type SessionContextValue = {
  sessions: Map<string, Session>;
  isLoading: boolean;
  error: Error | null;
  refreshSessions: (showLoading?: boolean) => Promise<void>;
  createSession: (request: CreateSessionRequest) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  unarchiveSession: (id: string) => Promise<void>;
  refreshSession: (id: string) => Promise<void>;
  updateAccessMode: (id: string, mode: AccessMode) => Promise<void>;
  updateSession: (id: string, title?: string, description?: string) => Promise<void>;
  regenerateMetadata: (id: string) => Promise<void>;
  client: ClauderonClient;
  // Health state
  healthReports: Map<string, SessionHealthReport>;
  refreshHealth: () => Promise<void>;
  getSessionHealth: (sessionId: string) => SessionHealthReport | undefined;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useClauderonClient();
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [healthReports, setHealthReports] = useState<Map<string, SessionHealthReport>>(new Map());

  const refreshSessions = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }
      setError(null);
      const sessionsList = await client.listSessions();
      const newSessions = new Map(sessionsList.map((s) => [s.id, s]));
      setSessions(newSessions);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [client]);

  const refreshHealth = useCallback(async () => {
    try {
      const health = await client.getHealth();
      const newHealthReports = new Map(
        health.sessions.map((report) => [report.session_id, report])
      );
      setHealthReports(newHealthReports);
    } catch (err) {
      console.error("Failed to fetch health data:", err);
    }
  }, [client]);

  const getSessionHealth = useCallback(
    (sessionId: string): SessionHealthReport | undefined => {
      return healthReports.get(sessionId);
    },
    [healthReports]
  );

  const createSession = useCallback(
    async (request: CreateSessionRequest) => {
      const result = await client.createSession(request);
      // WebSocket events will update the session list automatically
      return result.id;
    },
    [client]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await client.deleteSession(id);
      setSessions((prev) => {
        const newSessions = new Map(prev);
        newSessions.delete(id);
        return newSessions;
      });
    },
    [client]
  );

  const archiveSession = useCallback(
    async (id: string) => {
      await client.archiveSession(id);
      await refreshSessions();
    },
    [client, refreshSessions]
  );

  const unarchiveSession = useCallback(
    async (id: string) => {
      await client.unarchiveSession(id);
      await refreshSessions();
    },
    [client, refreshSessions]
  );

  const refreshSession = useCallback(
    async (id: string) => {
      await client.refreshSession(id);
      await refreshSessions();
    },
    [client, refreshSessions]
  );

  const updateAccessMode = useCallback(
    async (id: string, mode: AccessMode) => {
      await client.updateAccessMode(id, mode);
      await refreshSessions();
    },
    [client, refreshSessions]
  );

  const updateSession = useCallback(
    async (id: string, title?: string, description?: string) => {
      await client.updateSessionMetadata(id, title, description);
      // WebSocket event will update state
    },
    [client]
  );

  const regenerateMetadata = useCallback(
    async (id: string) => {
      await client.regenerateMetadata(id);
      await refreshSessions();
    },
    [client, refreshSessions]
  );

  // Handle real-time events
  const handleEvent = useCallback((event: { type: string; payload?: Session | { id: string } }) => {
    switch (event.type) {
      case "SessionCreated":
      case "SessionUpdated": {
        // Event payload contains the full session object
        const session = event.payload as Session;
        setSessions((prev) => {
          const newSessions = new Map(prev);
          newSessions.set(session.id, session);
          return newSessions;
        });
        break;
      }
      case "SessionDeleted": {
        // Event payload contains { id: string }
        const payload = event.payload as { id: string };
        if (payload.id) {
          setSessions((prev) => {
            const newSessions = new Map(prev);
            newSessions.delete(payload.id);
            return newSessions;
          });
        }
        break;
      }
    }
  }, []);

  useSessionEvents(handleEvent);

  // Initial load
  useEffect(() => {
    void refreshSessions();
    void refreshHealth();
  }, [refreshSessions, refreshHealth]);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        isLoading,
        error,
        refreshSessions,
        createSession,
        deleteSession,
        archiveSession,
        unarchiveSession,
        refreshSession,
        updateAccessMode,
        updateSession,
        regenerateMetadata,
        client,
        healthReports,
        refreshHealth,
        getSessionHealth,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return context;
}
