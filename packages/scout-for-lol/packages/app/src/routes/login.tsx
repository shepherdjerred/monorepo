import { useSearchParams } from "react-router-dom";
import { Button } from "#src/components/ui/button.tsx";

/**
 * The "Sign in with Discord" anchor points at the backend's
 * /api/auth/discord/start route. That route mints the OAuth state
 * nonce, sets the pre-auth cookie, and 302s the browser to Discord —
 * all without the SPA touching any token material.
 */
export function Login() {
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") ?? "/app/";
  const error = params.get("error");

  const startUrl = `/api/auth/discord/start?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="grid min-h-screen place-items-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Scout for LoL
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in with Discord to manage your guild&apos;s subscriptions.
          </p>
        </div>
        {error !== null && (
          <p className="text-sm text-destructive">{describeError(error)}</p>
        )}
        <Button asChild size="lg" className="w-full">
          <a href={startUrl}>Sign in with Discord</a>
        </Button>
      </div>
    </div>
  );
}

function describeError(error: string): string {
  switch (error) {
    case "state_mismatch":
      return "Discord sign-in expired or was tampered with. Please try again.";
    case "access_denied":
      return "You denied Scout access. To use the web UI, sign in again and approve.";
    default:
      return `Discord sign-in error: ${error}`;
  }
}
