import { useState, useEffect, useCallback } from "react";
import type { Session } from "../types";

interface SessionsState {
  sessions: Session[];
  loading: boolean;
  error: string | null;
}

export function useSessions() {
  const [state, setState] = useState<SessionsState>({
    sessions: [],
    loading: true,
    error: null,
  });

  const fetchSessions = useCallback(async () => {
    try {
      setState((s) => ({ ...s, loading: true }));
      const response = await fetch("/api/sessions", {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setState({ sessions: data.sessions, loading: false, error: null });
      } else {
        setState({ sessions: [], loading: false, error: "Failed to fetch sessions" });
      }
    } catch (error) {
      setState({
        sessions: [],
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const createSession = useCallback(async (repoUrl: string, baseBranch: string) => {
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ repoUrl, baseBranch }),
      });

      if (response.ok) {
        const data = await response.json();
        setState((s) => ({
          ...s,
          sessions: [data.session, ...s.sessions],
        }));
        return data.session as Session;
      } else {
        const error = await response.json();
        throw new Error(error.error || "Failed to create session");
      }
    } catch (error) {
      throw error;
    }
  }, []);

  const stopSession = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (response.ok) {
        setState((s) => ({
          ...s,
          sessions: s.sessions.map((session) =>
            session.id === sessionId ? { ...session, status: "stopped" as const } : session
          ),
        }));
      } else {
        throw new Error("Failed to stop session");
      }
    } catch (error) {
      throw error;
    }
  }, []);

  const commitChanges = useCallback(async (sessionId: string, message: string) => {
    const response = await fetch(`/api/sessions/${sessionId}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to commit");
    }

    return response.json();
  }, []);

  const pushChanges = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/sessions/${sessionId}/push`, {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to push");
    }

    return response.json();
  }, []);

  const createPullRequest = useCallback(
    async (sessionId: string, title: string, body: string) => {
      const response = await fetch(`/api/sessions/${sessionId}/pr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title, body }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create PR");
      }

      return response.json();
    },
    []
  );

  return {
    sessions: state.sessions,
    loading: state.loading,
    error: state.error,
    refresh: fetchSessions,
    createSession,
    stopSession,
    commitChanges,
    pushChanges,
    createPullRequest,
  };
}
