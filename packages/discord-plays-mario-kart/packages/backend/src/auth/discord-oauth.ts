// Sign in with Discord: the OAuth2 authorization-code grant, by hand.
//
// Ported from Streambot's WebAuth (packages/streambot/src/web/server/auth.ts).
// The page only needs to know who is at the keyboard, so the scope is
// `identify`; whether they are in the game's voice channel comes from the bot's
// own gateway cache, never from the browser.
//
// Handlers take a plain request description and return a plain result, so the
// flow is testable without Express; `mountAuthRoutes` adapts them.
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  Express,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import { z } from "zod";
import {
  AUTH_CALLBACK_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_START_PATH,
  ME_PATH,
  type DiscordUser,
  type Me,
} from "@discord-plays-mario-kart/common";
import { logger } from "#src/logger.ts";
import { avatarUrl, toPlayerName } from "./names.ts";
import {
  SESSION_LIFETIME_SECONDS,
  digest,
  nonce,
  type WebSessionStore,
} from "./session-store.ts";

export const SESSION_COOKIE = "mk64_session";
const STATE_COOKIE = "mk64_oauth_state";
const STATE_LIFETIME_MS = 5 * 60 * 1000;
const DISCORD_API = "https://discord.com/api/v10";

const TokenSchema = z.object({ access_token: z.string().min(1) });
const DiscordApiUserSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  username: z.string().min(1),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable(),
});

export type AuthConfig = {
  /** The origin players reach the page on, e.g. https://mariokart.sjer.red. */
  publicOrigin: string;
  clientId: string;
  clientSecret: string;
};

/** The slice of `fetch` the flow uses; tests substitute a fake Discord. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type AuthRequest = {
  /** Path and query, as the server received them. */
  url: string;
  cookieHeader: string | undefined;
};

export type AuthResult =
  | { kind: "redirect"; location: string; cookies: string[] }
  | { kind: "json"; status: number; body: unknown; cookies: string[] };

/** One cookie's value from a Cookie header, or undefined. */
export function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  const part = header
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return part?.slice(name.length + 1);
}

/** Map Discord's user object to the page's identity. */
export function discordUserFrom(
  api: z.infer<typeof DiscordApiUserSchema>,
): DiscordUser {
  return {
    discordId: api.id,
    username: api.username,
    name: toPlayerName([api.global_name], api.username),
    avatarUrl: avatarUrl(api.id, api.avatar),
  };
}

export class DiscordAuth {
  private readonly stateSecret = nonce();
  private readonly usedStates = new Map<string, number>();
  private readonly config: AuthConfig;
  private readonly sessions: WebSessionStore;
  private readonly fetchFn: FetchLike;

  constructor(deps: {
    config: AuthConfig;
    sessions: WebSessionStore;
    fetch?: FetchLike;
  }) {
    this.config = deps.config;
    this.sessions = deps.sessions;
    this.fetchFn = deps.fetch ?? ((url, init) => fetch(url, init));
  }

  /** The signed-in user behind a Cookie header, if any. */
  async identify(
    cookieHeader: string | undefined,
  ): Promise<DiscordUser | undefined> {
    const token = cookieValue(cookieHeader, SESSION_COOKIE);
    return token === undefined ? undefined : this.sessions.read(token);
  }

  start(nowMs = Date.now()): AuthResult {
    const payload = `${String(nowMs + STATE_LIFETIME_MS)}.${nonce()}`;
    const state = `${payload}.${this.sign(payload)}`;
    const target = new URL("https://discord.com/oauth2/authorize");
    target.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      scope: "identify",
      state,
      redirect_uri: this.callbackUrl(),
      prompt: "none",
    }).toString();
    return {
      kind: "redirect",
      location: target.href,
      cookies: [this.cookie(STATE_COOKIE, state, STATE_LIFETIME_MS / 1000)],
    };
  }

  async callback(
    request: AuthRequest,
    nowMs = Date.now(),
  ): Promise<AuthResult> {
    const params = new URL(request.url, this.config.publicOrigin).searchParams;
    const clearState = this.cookie(STATE_COOKIE, "", 0);
    const state = params.get("state");
    const saved = cookieValue(request.cookieHeader, STATE_COOKIE);
    if (
      state === null ||
      saved === undefined ||
      !this.stateIsValid(state, saved, nowMs)
    ) {
      return {
        kind: "redirect",
        location: "/?signin=expired",
        cookies: [clearState],
      };
    }
    const code = params.get("code");
    if (code === null || params.has("error")) {
      return {
        kind: "redirect",
        location: "/?signin=cancelled",
        cookies: [clearState],
      };
    }

    let user: DiscordUser;
    try {
      user = await this.exchange(code);
    } catch (error) {
      logger.warn("discord sign-in failed", error);
      return {
        kind: "redirect",
        location: "/?signin=failed",
        cookies: [clearState],
      };
    }
    const previous = cookieValue(request.cookieHeader, SESSION_COOKIE);
    if (previous !== undefined) await this.sessions.delete(previous);
    const token = await this.sessions.create(user, nowMs);
    logger.info("discord sign-in", { discordId: user.discordId });
    return {
      kind: "redirect",
      location: "/",
      cookies: [
        clearState,
        this.cookie(SESSION_COOKIE, token, SESSION_LIFETIME_SECONDS),
      ],
    };
  }

  async logout(request: AuthRequest): Promise<AuthResult> {
    const token = cookieValue(request.cookieHeader, SESSION_COOKIE);
    if (token !== undefined) await this.sessions.delete(token);
    return {
      kind: "json",
      status: 200,
      body: { signedIn: false } satisfies Me,
      cookies: [this.cookie(SESSION_COOKIE, "", 0)],
    };
  }

  async me(request: AuthRequest): Promise<AuthResult> {
    const user = await this.identify(request.cookieHeader);
    const body: Me =
      user === undefined ? { signedIn: false } : { signedIn: true, user };
    return { kind: "json", status: 200, body, cookies: [] };
  }

  private async exchange(code: string): Promise<DiscordUser> {
    const tokenResponse = await this.request(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: this.callbackUrl(),
      }),
    });
    const token = TokenSchema.parse(await tokenResponse.json());
    const userResponse = await this.request(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    return discordUserFrom(
      DiscordApiUserSchema.parse(await userResponse.json()),
    );
  }

  /**
   * A state is good once: signed by this process, unexpired, equal to the copy
   * in this browser's cookie, and not seen before. A restart invalidates
   * in-flight sign-ins, which only costs a retry.
   */
  private stateIsValid(state: string, saved: string, nowMs: number): boolean {
    const expires = this.stateExpiry(state);
    if (expires === undefined || expires <= nowMs) return false;
    if (
      !timingSafeEqual(
        Buffer.from(digest(state), "hex"),
        Buffer.from(digest(saved), "hex"),
      )
    ) {
      return false;
    }
    for (const [key, deadline] of this.usedStates) {
      if (deadline <= nowMs) this.usedStates.delete(key);
    }
    const key = digest(state);
    if (this.usedStates.has(key)) return false;
    this.usedStates.set(key, expires);
    return true;
  }

  private stateExpiry(state: string): number | undefined {
    const [expiry, random, signature, ...rest] = state.split(".");
    if (
      expiry === undefined ||
      random === undefined ||
      signature === undefined ||
      rest.length > 0 ||
      !/^\d+$/u.test(expiry) ||
      !/^[a-f0-9]{64}$/u.test(signature)
    ) {
      return undefined;
    }
    const expected = this.sign(`${expiry}.${random}`);
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    )
      ? Number(expiry)
      : undefined;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.stateSecret).update(payload).digest("hex");
  }

  private callbackUrl(): string {
    return `${this.config.publicOrigin}${AUTH_CALLBACK_PATH}`;
  }

  private cookie(name: string, value: string, maxAgeSeconds: number): string {
    const secure = this.config.publicOrigin.startsWith("https:")
      ? "; Secure"
      : "";
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(maxAgeSeconds)}${secure}`;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const response = await this.fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`discord ${url} returned ${String(response.status)}`);
    }
    return response;
  }
}

function send(res: ExpressResponse, result: AuthResult): void {
  res.setHeader("cache-control", "no-store");
  for (const cookie of result.cookies) res.append("set-cookie", cookie);
  if (result.kind === "redirect") {
    res.redirect(302, result.location);
    return;
  }
  res.status(result.status).json(result.body);
}

function describe(req: ExpressRequest): AuthRequest {
  return { url: req.originalUrl, cookieHeader: req.headers.cookie };
}

async function respond(
  res: ExpressResponse,
  run: () => AuthResult | Promise<AuthResult>,
): Promise<void> {
  try {
    send(res, await run());
  } catch (error) {
    logger.error("auth route failed", error);
    res.status(500).json({ error: "sign-in is unavailable" });
  }
}

function handle(
  run: (req: ExpressRequest) => AuthResult | Promise<AuthResult>,
): (req: ExpressRequest, res: ExpressResponse) => void {
  return (req, res) => {
    void respond(res, () => run(req));
  };
}

/** Serve the sign-in routes from the page's own Express app. */
export function mountAuthRoutes(app: Express, auth: DiscordAuth): void {
  app.get(
    AUTH_START_PATH,
    handle(() => auth.start()),
  );
  app.get(
    AUTH_CALLBACK_PATH,
    handle((req) => auth.callback(describe(req))),
  );
  app.post(
    AUTH_LOGOUT_PATH,
    handle((req) => auth.logout(describe(req))),
  );
  app.get(
    ME_PATH,
    handle((req) => auth.me(describe(req))),
  );
}
