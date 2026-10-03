import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { WebError } from "./errors.ts";
import {
  digest,
  nonce,
  sessionLifetimeSeconds,
  type WebSession,
  type WebSessionStore,
} from "./session-store.ts";

export type WebBootstrap = {
  publicOrigin: string;
  clientSecret: string;
  port: number;
};
const TokenSchema = z.object({ access_token: z.string() });
const UserSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  username: z.string(),
});
const GuildsSchema = z.array(z.object({ id: z.string().regex(/^\d+$/u) }));
const COOKIE_NAME = "streambot_session";
const CSRF_COOKIE = "streambot_csrf";
const STATE_COOKIE = "streambot_oauth_state";

export function cookieValue(request: Request, name: string): string | null {
  const part = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(name + "="));
  return part === undefined ? null : part.slice(name.length + 1);
}

export class WebAuth {
  private readonly stateSecret = nonce();
  private readonly usedStates = new Map<string, number>();
  constructor(
    private readonly deps: {
      bootstrap: WebBootstrap;
      applicationId: () => string;
      store: WebSessionStore;
      fetch?: typeof fetch;
    },
  ) {}

  session(request: Request): WebSession {
    const token = cookieValue(request, COOKIE_NAME);
    const session = token === null ? null : this.deps.store.read(token);
    if (session === null)
      throw new WebError(401, "sign_in", "Sign in with Discord to continue.");
    return session;
  }

  csrfToken(request: Request, session: WebSession): string {
    const token = cookieValue(request, CSRF_COOKIE);
    if (token === null || digest(token) !== session.csrfHash)
      throw new WebError(403, "csrf", "Refresh the page and try again.");
    return token;
  }

  mutation(request: Request, session: WebSession): void {
    const token = request.headers.get("x-csrf-token");
    if (
      token === null ||
      request.headers.get("origin") !== this.deps.bootstrap.publicOrigin ||
      digest(token) !== session.csrfHash
    ) {
      throw new WebError(403, "csrf", "Refresh the page and try again.");
    }
  }

  start(): Response {
    const payload = String(Date.now() + 5 * 60 * 1000) + "." + nonce();
    const state = payload + "." + this.signState(payload);
    const target = new URL("https://discord.com/oauth2/authorize");
    target.search = new URLSearchParams({
      client_id: this.deps.applicationId(),
      response_type: "code",
      scope: "identify guilds",
      state,
      redirect_uri: this.callbackUrl(),
    }).toString();
    return this.redirect(target.href, [
      this.cookie(STATE_COOKIE, state, 300, true),
    ]);
  }

  async callback(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const state = params.get("state");
    const saved = cookieValue(request, STATE_COOKIE);
    const expires = state === null ? null : this.stateExpiry(state);
    if (
      state === null ||
      saved === null ||
      expires === null ||
      expires <= Date.now() ||
      this.usedStates.has(digest(state)) ||
      !timingSafeEqual(
        Buffer.from(digest(state), "hex"),
        Buffer.from(digest(saved), "hex"),
      )
    ) {
      throw new WebError(400, "oauth_state", "Sign-in expired. Start again.");
    }
    // Only callbacks consume memory. The authorization code is independently single-use
    // at Discord; this bounded cache also rejects immediate replay before any external I/O.
    for (const [key, deadline] of this.usedStates)
      if (deadline <= Date.now()) this.usedStates.delete(key);
    if (this.usedStates.size >= 1000) {
      const oldest = this.usedStates.keys().next().value;
      if (oldest !== undefined) this.usedStates.delete(oldest);
    }
    this.usedStates.set(digest(state), expires);
    const code = params.get("code");
    if (code === null || params.has("error"))
      return this.redirect("/?login=cancelled", [
        this.cookie(STATE_COOKIE, "", 0, true),
      ]);
    const response = await this.request(
      "https://discord.com/api/v10/oauth2/token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: this.deps.applicationId(),
          client_secret: this.deps.bootstrap.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: this.callbackUrl(),
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
    );
    const token = TokenSchema.parse(await response.json());
    const headers = { Authorization: "Bearer " + token.access_token };
    const [userResponse, guildResponse] = await Promise.all([
      this.request("https://discord.com/api/v10/users/@me", { headers }),
      this.request("https://discord.com/api/v10/users/@me/guilds", { headers }),
    ]);
    const user = UserSchema.parse(await userResponse.json());
    const guilds = GuildsSchema.parse(await guildResponse.json());
    const previous = cookieValue(request, COOKIE_NAME);
    if (previous !== null) this.deps.store.delete(previous);
    const created = this.deps.store.create({
      userId: user.id,
      username: user.username,
      guildIds: guilds.map((guild) => guild.id),
    });
    return this.redirect("/", [
      this.cookie(STATE_COOKIE, "", 0, true),
      this.cookie(COOKIE_NAME, created.token, sessionLifetimeSeconds, true),
      this.cookie(
        CSRF_COOKIE,
        created.csrfToken,
        sessionLifetimeSeconds,
        false,
      ),
    ]);
  }

  logout(request: Request): Response {
    const token = cookieValue(request, COOKIE_NAME);
    if (token !== null) this.deps.store.delete(token);
    return this.redirect("/", [
      this.cookie(COOKIE_NAME, "", 0, true),
      this.cookie(CSRF_COOKIE, "", 0, false),
    ]);
  }

  private callbackUrl(): string {
    return this.deps.bootstrap.publicOrigin + "/api/auth/discord/callback";
  }
  private signState(payload: string): string {
    return createHmac("sha256", this.stateSecret).update(payload).digest("hex");
  }
  private stateExpiry(state: string): number | null {
    const parts = state.split(".");
    if (parts.length !== 3) return null;
    const [expiry, random, signature] = parts;
    if (
      expiry === undefined ||
      random === undefined ||
      signature === undefined ||
      !/^\d+$/u.test(expiry) ||
      !/^[a-f0-9]{64}$/u.test(signature)
    )
      return null;
    const expected = this.signState(expiry + "." + random);
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    )
      ? Number(expiry)
      : null;
  }
  private cookie(
    name: string,
    value: string,
    maxAge: number,
    httpOnly: boolean,
  ): string {
    return (
      name +
      "=" +
      value +
      "; Path=/; SameSite=Lax; Max-Age=" +
      String(maxAge) +
      (httpOnly ? "; HttpOnly" : "") +
      (this.deps.bootstrap.publicOrigin.startsWith("https:") ? "; Secure" : "")
    );
  }
  private redirect(location: string, cookies: string[]): Response {
    const headers = new Headers({ Location: location });
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  }
  private async request(url: string, init: RequestInit): Promise<Response> {
    const response = await (this.deps.fetch ?? fetch)(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new WebError(
        502,
        "discord_unavailable",
        "Discord sign-in is unavailable. Try again shortly.",
      );
    return response;
  }
}
