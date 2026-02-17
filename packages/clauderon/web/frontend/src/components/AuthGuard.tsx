import type { ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import { LoginPage } from "../pages/LoginPage";
import { RegistrationPage } from "../pages/RegistrationPage";

type AuthGuardProps = {
  children: ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const { authStatus, isLoading } = useAuth();

  // Show loading state
  if (isLoading || !authStatus) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If auth is not required (localhost mode), render children directly
  if (!authStatus.requires_auth) {
    return <>{children}</>;
  }

  // Auth is required - check if we need registration or login
  if (!authStatus.has_users) {
    // No users exist - show registration
    return <RegistrationPage />;
  }

  if (!authStatus.current_user) {
    // User not logged in - show login
    return <LoginPage />;
  }

  // User is authenticated - render children
  return <>{children}</>;
}
