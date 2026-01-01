import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Session, CreateSessionRequest, AccessMode } from "@mux/client";
import { useMuxClient } from "../hooks/useMuxClient";
import { useSessionEvents } from "../hooks/useSessionEvents";
import { MuxClient } from "@mux/client";

type SessionContextValue = {
  sessions: Map<string, Session>;
  isLoading: boolean;
  error: Error | null;
  refreshSessions: () => Promise<void>;
  createSession: (request: CreateSessionRequest) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  updateAccessMode: (id: string, mode: AccessMode) => Promise<void>;
  client: MuxClient;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useMuxClient();
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const sessionsList = await client.listSessions();
      const newSessions = new Map(sessionsList.map((s) => [s.id, s]));
      setSessions(newSessions);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  const createSession = useCallback(
    async (request: CreateSessionRequest) => {
      const result = await client.createSession(request);
      await refreshSessions();
      return result.id;
    },
    [client, refreshSessions]
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

  const updateAccessMode = useCallback(
    async (id: string, mode: AccessMode) => {
      await client.updateAccessMode(id, mode);
      await refreshSessions();
    },
    [client, refreshSessions]
  );

  // Handle real-time events
  const handleEvent = useCallback((event: { type: string; session?: Session; sessionId?: string }) => {
    switch (event.type) {
      case "session_created":
      case "session_updated": {
        const session = event.session;
        if (session) {
          setSessions((prev) => {
            const newSessions = new Map(prev);
            newSessions.set(session.id, session);
            return newSessions;
          });
        }
        break;
      }
      case "session_deleted": {
        const sessionId = event.sessionId;
        if (sessionId) {
          setSessions((prev) => {
            const newSessions = new Map(prev);
            newSessions.delete(sessionId);
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
  }, [refreshSessions]);

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
        updateAccessMode,
        client,
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
