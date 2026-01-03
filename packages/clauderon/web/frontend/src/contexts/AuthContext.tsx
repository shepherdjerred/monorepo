import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthStatus, AuthUser } from "@clauderon/shared";
import { useClauderonClient } from "./ClauderonContext";

interface AuthContextValue {
  authStatus: AuthStatus | null;
  currentUser: AuthUser | null;
  isLoading: boolean;
  refreshAuthStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useClauderonClient();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAuthStatus = async () => {
    try {
      const status = await client.getAuthStatus();
      setAuthStatus(status);
    } catch (error) {
      console.error("Failed to get auth status:", error);
      setAuthStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAuthStatus();
  }, []);

  const currentUser = authStatus?.current_user ?? null;

  return (
    <AuthContext.Provider value={{ authStatus, currentUser, isLoading, refreshAuthStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
