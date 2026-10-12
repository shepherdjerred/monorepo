// Deployment wiring for Discord sign-in, from the environment.
//
// The client secret is a credential, and the public origin is where this
// deployment is reachable: both arrive by env, set by the homelab Deployment,
// so they change together with the code that needs them.
import { publicOriginFromEnv } from "#src/webserver/origin.ts";

export type AuthBootstrap = { publicOrigin: string; clientSecret: string };

/** Read the sign-in settings; throws naming whichever is missing or invalid. */
export function authBootstrapFromEnv(
  env: Record<string, string | undefined>,
): AuthBootstrap {
  const publicOrigin = publicOriginFromEnv(env);
  const clientSecret = env["DISCORD_CLIENT_SECRET"];
  if (clientSecret === undefined || clientSecret.length === 0) {
    throw new Error(
      "DISCORD_CLIENT_SECRET is required when the web API is enabled: playing needs Discord sign-in",
    );
  }
  return { publicOrigin, clientSecret };
}
