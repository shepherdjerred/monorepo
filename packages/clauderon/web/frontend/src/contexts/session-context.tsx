import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type {
  Session,
  CreateSessionRequest,
  AccessMode,
  SessionHealthReport,
} from "@clauderon/client";
import type { MergeMethod } from "@clauderon/shared";
import { useClauderonClient } from "@/hooks/use-clauderon-client.ts";
import { useSessionEvents } from "@/hooks/use-session-events.ts";
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
  updateSession: (
    id: string,
    title?: string,
    description?: string,
  ) => Promise<void>;
  regenerateMetadata: (id: string) => Promise<void>;
  mergePr: (
    id: string,
    method: MergeMethod,
    deleteBranch: boolean,
  ) => Promise<void>;
  client: ClauderonClient;
  // Health state
  healthReports: Map<string, SessionHealthReport>;
  refreshHealth: () => Promise<void>;
  getSessionHealth: (sessionId: string) => SessionHealthReport | undefined;
  // Health actions
  startSession: (id: string) => Promise<void>;
  wakeSession: (id: string) => Promise<void>;
  recreateSession: (id: string) => Promise<void>;
  cleanupSession: (id: string) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | undefined>(
  undefined,
);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useClauderonClient();
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [healthReports, setHealthReports] = useState<
    Map<string, SessionHealthReport>
  >(new Map());

  const refreshSessions = useCallback(
    async (showLoading = true) => {
      try {
        if (showLoading) {
          setIsLoading(true);
        }
        setError(null);
        const sessionsList = await client.listSessions();
        const newSessions = new Map(sessionsList.map((s: Session) => [s.id, s]));
        setSessions(newSessions);
      } catch (error_) {
        setError(error_ instanceof Error ? error_ : new Error(String(error_)));
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [client],
  );

  const refreshHealth = useCallback(async () => {
    try {
      const health = await client.getHealth();
      const newHealthReports = new Map(
        health.sessions.map((report: SessionHealthReport) => [report.session_id, report]),
      );
      setHealthReports(newHealthReports);
    } catch (error_) {
      console.error("Failed to fetch health data:", error_);
    }
  }, [client]);

  const getSessionHealth = useCallback(
    (sessionId: string): SessionHealthReport | undefined => {
      return healthReports.get(sessionId);
    },
    [healthReports],
  );

  const createSession = useCallback(
    async (request: CreateSessionRequest) => {
      const result = await client.createSession(request);
      // WebSocket events will update the session list automatically
      return result.id;
    },
    [client],
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
    [client],
  );

  const archiveSession = useCallback(
    async (id: string) => {
      await client.archiveSession(id);
      await refreshSessions();
    },
    [client, refreshSessions],
  );

  const unarchiveSession = useCallback(
    async (id: string) => {
      await client.unarchiveSession(id);
      await refreshSessions();
    },
    [client, refreshSessions],
  );

  const refreshSession = useCallback(
    async (id: string) => {
      await client.refreshSession(id);
      await refreshSessions();
    },
    [client, refreshSessions],
  );

  const updateAccessMode = useCallback(
    async (id: string, mode: AccessMode) => {
      await client.updateAccessMode(id, mode);
      await refreshSessions();
    },
    [client, refreshSessions],
  );

  const updateSession = useCallback(
    async (id: string, title?: string, description?: string) => {
      await client.updateSessionMetadata(id, title, description);
      // WebSocket event will update state
    },
    [client],
  );

  const regenerateMetadata = useCallback(
    async (id: string) => {
      await client.regenerateMetadata(id);
      await refreshSessions();
    },
    [client, refreshSessions],
  );

  const startSession = useCallback(
    async (id: string) => {
      await client.startSession(id);
      await Promise.all([refreshSessions(), refreshHealth()]);
    },
    [client, refreshSessions, refreshHealth],
  );

  const wakeSession = useCallback(
    async (id: string) => {
      await client.wakeSession(id);
      await Promise.all([refreshSessions(), refreshHealth()]);
    },
    [client, refreshSessions, refreshHealth],
  );

  const recreateSession = useCallback(
    async (id: string) => {
      await client.recreateSession(id);
      await Promise.all([refreshSessions(), refreshHealth()]);
    },
    [client, refreshSessions, refreshHealth],
  );

  const cleanupSession = useCallback(
    async (id: string) => {
      await client.cleanupSession(id);
      await Promise.all([refreshSessions(), refreshHealth()]);
    },
    [client, refreshSessions, refreshHealth],
  );

  const mergePr = useCallback(
    async (id: string, method: MergeMethod, deleteBranch: boolean) => {
      await client.mergePr(id, method, deleteBranch);
      await refreshSessions();
    },
    [client, refreshSessions],
  );

  // Handle real-time events using the typed SessionEvent discriminated union
  const handleSessionCreatedOrUpdated = useCallback(
    (payload: Session | { id: string } | undefined) => {
      // Session objects have a `name` property, while delete payloads do not
      if (payload != null && "name" in payload) {
        setSessions((prev) => {
          const newSessions = new Map(prev);
          newSessions.set(payload.id, payload);
          return newSessions;
        });
      }
    },
    [],
  );

  const handleSessionDeleted = useCallback(
    (payload: Session | { id: string } | undefined) => {
      if (payload != null && "id" in payload) {
        setSessions((prev) => {
          const newSessions = new Map(prev);
          newSessions.delete(payload.id);
          return newSessions;
        });
      }
    },
    [],
  );

  const handleEvent = useCallback(
    (event: { type: string; payload?: Session | { id: string } }) => {
      switch (event.type) {
        case "SessionCreated":
        case "SessionUpdated":
          handleSessionCreatedOrUpdated(event.payload);
          break;
        case "SessionDeleted":
          handleSessionDeleted(event.payload);
          break;
      }
    },
    [handleSessionCreatedOrUpdated, handleSessionDeleted],
  );

  useSessionEvents(handleEvent);

  // Initial load
  ;

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
        mergePr,
        client,
        healthReports,
        refreshHealth,
        getSessionHealth,
        startSession,
        wakeSession,
        recreateSession,
        cleanupSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  const context = useContext(SessionContext);
  if (context == null) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return context;
}
