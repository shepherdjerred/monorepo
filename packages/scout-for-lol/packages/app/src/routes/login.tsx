import { useSearchParams } from "react-router-dom";

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
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1>Scout for LoL</h1>
        <p>Sign in with Discord to manage your guild&apos;s subscriptions.</p>
        {error !== null && (
          <p style={{ color: "crimson" }}>{describeError(error)}</p>
        )}
        <a
          href={startUrl}
          style={{
            display: "inline-block",
            padding: "0.75rem 1.5rem",
            background: "#5865F2",
            color: "white",
            textDecoration: "none",
            borderRadius: 6,
          }}
        >
          Sign in with Discord
        </a>
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
