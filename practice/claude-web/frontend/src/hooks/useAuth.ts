import { useState, useEffect, useCallback } from "react";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch("/auth/me", {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setState({ user: data.user, loading: false, error: null });
      } else if (response.status === 401) {
        setState({ user: null, loading: false, error: null });
      } else {
        setState({ user: null, loading: false, error: "Failed to fetch user" });
      }
    } catch (error) {
      setState({
        user: null,
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = useCallback(() => {
    window.location.href = "/auth/github";
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      setState({ user: null, loading: false, error: null });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, []);

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    login,
    logout,
    refresh: fetchUser,
  };
}
