import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTRPC } from "#src/lib/trpc.ts";

export function Login() {
  const trpc = useTRPC();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") ?? "/app/";
  const error = params.get("error");
  const [callbackOrigin, setCallbackOrigin] = useState<string | null>(null);

  useEffect(() => {
    setCallbackOrigin(globalThis.location.origin);
  }, []);

  const oauthQuery = useQuery(
    trpc.auth.getWebOAuthUrl.queryOptions(
      callbackOrigin === null
        ? { callbackOrigin: "https://scout-for-lol.com", returnTo }
        : { callbackOrigin, returnTo },
      { enabled: callbackOrigin !== null },
    ),
  );

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
          <p style={{ color: "crimson" }}>Discord sign-in error: {error}</p>
        )}
        {oauthQuery.data === undefined ? (
          <button type="button" disabled>
            Loading…
          </button>
        ) : (
          <a
            href={oauthQuery.data.url}
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
        )}
      </div>
    </div>
  );
}
