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

// sessionStorage key for the CSRF nonce echoed back via Discord's `state`
// param on the redirect-back flow. Lets the landing page tell a real install
// completion apart from a hand-crafted `/installed?guild_id=…` link.
const INSTALL_STATE_KEY = "scout_install_state";

/**
 * Mint a fresh install nonce and stash it in sessionStorage. Returned so the
 * caller can hand it to Discord as `state`; the landing page compares it with
 * {@link consumeInstallState}.
 */
function issueInstallState(): string {
  const nonce = globalThis.crypto.randomUUID();
  globalThis.window.sessionStorage.setItem(INSTALL_STATE_KEY, nonce);
  return nonce;
}

/**
 * Read and clear the install nonce. Returns `true` only when `received`
 * matches the value we issued, so a fabricated landing URL (no matching
 * sessionStorage entry) is rejected. Single-use: the key is removed on read.
 */
export function consumeInstallState(received: string | null): boolean {
  const stored = globalThis.window.sessionStorage.getItem(INSTALL_STATE_KEY);
  globalThis.window.sessionStorage.removeItem(INSTALL_STATE_KEY);
  return received !== null && received.length > 0 && received === stored;
}

/**
 * Build the Discord bot-install URL. Evaluated lazily (not at module load) so
 * `window`/`crypto` are only touched in a browser at click time — importing
 * this module from a non-DOM context (e.g. a Bun unit test) stays safe.
 *
 * In the redirect-back (beta) flow we attach a single-use `state` nonce; the
 * `/installed` landing route validates it via {@link consumeInstallState}.
 */
export function discordInviteUrl(): string {
  if (!DISCORD_INSTALL_REDIRECTS_BACK) {
    return `https://discord.com/oauth2/authorize?client_id=${id}`;
  }
  const params = new URLSearchParams({
    client_id: id,
    scope: INSTALL_SCOPES,
    permissions: INSTALL_PERMISSIONS,
    response_type: "code",
    state: issueInstallState(),
    redirect_uri: `${globalThis.window.location.origin}/app/installed`,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
