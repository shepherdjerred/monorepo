import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { AuthStatus, AuthUser } from "@clauderon/shared";
import { useClauderonClient } from "../hooks/useClauderonClient";

type AuthContextValue = {
  authStatus: AuthStatus | null;
  currentUser: AuthUser | null;
  isLoading: boolean;
  refreshAuthStatus: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useClauderonClient();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await client.getAuthStatus();
      setAuthStatus(status);
    } catch (error) {
      // 404 means auth is not enabled (localhost mode) - this is expected
      if (
        error instanceof Error &&
        error.message.includes("Authentication not enabled")
      ) {
        setAuthStatus({
          requires_auth: false,
          has_users: false,
        });
      } else {
        console.error("Failed to get auth status:", error);
        setAuthStatus(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshAuthStatus();
  }, [refreshAuthStatus]);

  const currentUser = authStatus?.current_user ?? null;

  return (
    <AuthContext.Provider
      value={{ authStatus, currentUser, isLoading, refreshAuthStatus }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context == null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
