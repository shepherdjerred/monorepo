// Deployment wiring for Discord sign-in, from the environment.
//
// The client secret is a credential, and the public origin is where this
// deployment is reachable: both arrive by env, set by the homelab Deployment,
// so they change together with the code that needs them.
import { z } from "zod";

const OriginSchema = z
  .url()
  .refine(
    (value) => new URL(value).origin === value,
    "an origin only: scheme, host and optional port, no trailing slash",
  );

export type AuthBootstrap = { publicOrigin: string; clientSecret: string };

/** Read the sign-in settings; throws naming whichever is missing or invalid. */
export function authBootstrapFromEnv(
  env: Record<string, string | undefined>,
): AuthBootstrap {
  const origin = env["WEB_PUBLIC_ORIGIN"];
  const clientSecret = env["DISCORD_CLIENT_SECRET"];
  if (origin === undefined || origin.length === 0) {
    throw new Error(
      "WEB_PUBLIC_ORIGIN is required when the web API is enabled: playing needs Discord sign-in",
    );
  }
  const parsed = OriginSchema.safeParse(origin);
  if (!parsed.success) {
    throw new Error(
      `WEB_PUBLIC_ORIGIN is not an origin: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  if (clientSecret === undefined || clientSecret.length === 0) {
    throw new Error(
      "DISCORD_CLIENT_SECRET is required when the web API is enabled: playing needs Discord sign-in",
    );
  }
  return { publicOrigin: parsed.data, clientSecret };
}
