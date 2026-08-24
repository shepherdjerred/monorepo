import { useSearchParams } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import { trackOutboundClick } from "#src/lib/analytics.ts";

export const LOGIN_DESCRIPTION =
  "Sign in with Discord to ask Scout, find players in shared servers, or manage servers where you have access.";

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
          <p className="text-sm text-scout-subtle">{LOGIN_DESCRIPTION}</p>
        </div>
        {error !== null && (
          <p className="text-sm text-scout-danger">{describeError(error)}</p>
        )}
        <Button asChild size="lg" className="w-full">
          <a
            href={startUrl}
            onClick={(clickEvent) => {
              trackOutboundClick(clickEvent, "login_click", startUrl);
            }}
          >
            Sign in with Discord
          </a>
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
