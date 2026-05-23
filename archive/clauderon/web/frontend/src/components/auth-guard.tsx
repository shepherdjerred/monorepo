import { useState, type ReactNode } from "react";
import { useAuthStatus } from "@/hooks/use-auth";
import { LoginPage } from "@/pages/login-page.tsx";
import { RegistrationPage } from "@/pages/registration-page.tsx";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type AuthGuardProps = {
  children: ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const { data, isLoading, isError, error, refetch } = useAuthStatus();
  const [timedOut] = useState(false);

  // Error state
  if (isError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
          <p className="text-muted-foreground font-mono">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refetch()}
            className="cursor-pointer"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading || !data) {
    if (timedOut) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground font-mono">
              Unable to connect to clauderon daemon
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              className="cursor-pointer"
            >
              Retry
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If auth is not required (localhost mode), render children directly
  if (!data.requires_auth) {
    return <>{children}</>;
  }

  // Auth is required - check if we need registration or login
  if (!data.has_users) {
    return <RegistrationPage />;
  }

  if (data.current_user == null) {
    return <LoginPage />;
  }

  // User is authenticated - render children
  return <>{children}</>;
}
