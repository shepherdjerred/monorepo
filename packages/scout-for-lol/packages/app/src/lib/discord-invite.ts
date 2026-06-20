import { z } from "zod";

// Production Scout bot (mirrors the marketing site's bare install link).
const PROD_CLIENT_ID = "1182800769188110366";
// Beta bot — the only app that has the `/app/installed` redirect URI
// registered, so it's the only one we hand a redirect_uri (a redirect the
// target app hasn't registered would make Discord reject the install).
const BETA_CLIENT_ID = "1311755320745394317";

// Configured install scopes + permission bitmask, read from the app itself
// (GET /applications/@me → install_params). Keep in sync with the portal.
const INSTALL_SCOPES = "bot applications.commands";
const INSTALL_PERMISSIONS = "2148352";

const EnvSchema = z.object({
  VITE_DISCORD_CLIENT_ID: z.string().min(1).optional(),
});

function clientId(): string {
  const parsed = EnvSchema.safeParse(import.meta.env);
  const fromEnv = parsed.success
    ? parsed.data.VITE_DISCORD_CLIENT_ID
    : undefined;
  return fromEnv ?? PROD_CLIENT_ID;
}

const id = clientId();

/**
 * Whether the install link returns the user to the app after they add the
 * bot. Only the beta app has `/app/installed` registered as a redirect, so
 * the prod link stays a bare modern install link (no redirect_uri) and
 * can't break.
 */
export const DISCORD_INSTALL_REDIRECTS_BACK = id === BETA_CLIENT_ID;

function buildInviteUrl(): string {
  if (!DISCORD_INSTALL_REDIRECTS_BACK) {
    return `https://discord.com/oauth2/authorize?client_id=${id}`;
  }
  const params = new URLSearchParams({
    client_id: id,
    scope: INSTALL_SCOPES,
    permissions: INSTALL_PERMISSIONS,
    response_type: "code",
    redirect_uri: `${globalThis.window.location.origin}/app/installed`,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export const DISCORD_INVITE_URL = buildInviteUrl();
