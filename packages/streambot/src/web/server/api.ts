import { serveWebAsset } from "./assets.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { CommandSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { GuildIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { WebAuth, type WebBootstrap } from "./auth.ts";
import type { WebSession, WebSessionStore } from "./session-store.ts";
import type { WebPlayback } from "./playback.ts";
import { WebActions } from "./actions.ts";
import { WebError, requestInput } from "./errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { ARTWORK_HOSTS } from "@shepherdjerred/streambot/web/shared/artwork.ts";

async function readCommand(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new WebError(
        400,
        "invalid_request",
        "Check your input and try again.",
      );
    throw error;
  }
  return requestInput(CommandSchema, value);
}

export function createWebHandler(deps: {
  bootstrap: WebBootstrap;
  store: WebSessionStore;
  playback: WebPlayback;
  applicationId: () => string;
  assetsDir: string;
  fetch?: typeof fetch;
}) {
  const auth = new WebAuth({
    bootstrap: deps.bootstrap,
    applicationId: deps.applicationId,
    store: deps.store,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  const actions = new WebActions(deps.playback);
  const requests = new Map<string, { count: number; resets: number }>();

  async function authenticated(
    request: Request,
    url: URL,
    session: WebSession,
  ): Promise<Response> {
    limitRequests(session.key);
    if (request.method === "POST") auth.mutation(request, session);
    if (url.pathname === "/api/auth/logout" && request.method === "POST")
      return auth.logout(request);
    if (url.pathname === "/api/me" && request.method === "GET") {
      return Response.json({
        user: session.identity,
        guilds: deps.playback.deps.bot.webGuilds(session.identity.guildIds),
        csrfToken: auth.csrfToken(request, session),
      });
    }
    if (
      request.method === "POST" &&
      ["/api/commands", "/api/subtitles"].includes(url.pathname)
    ) {
      const input = await readCommand(request);
      if (url.pathname === "/api/subtitles")
        return Response.json(
          await actions.subtitles(session, input, request.signal),
        );
      const result = await actions.execute(session, input, request.signal);
      return Response.json({ message: result.message });
    }
    if (request.method !== "GET")
      throw new WebError(405, "method", "This method is not supported.");
    return await browseMedia(request, url, session);
  }

  async function browseMedia(
    request: Request,
    url: URL,
    session: WebSession,
  ): Promise<Response> {
    const guildId = url.searchParams.get("guildId") ?? "";
    if (url.pathname === "/api/player")
      return Response.json(await deps.playback.snapshot(session, guildId));
    await deps.playback.authorize(session, guildId);
    if (url.pathname === "/api/artwork")
      return await deps.playback.deps.catalog.artwork.resolve(
        url.searchParams.get("id") ?? "",
      );
    if (url.pathname === "/api/sports") {
      if (!(await deps.playback.sportsEnabled(session, guildId)))
        throw new WebError(
          403,
          "sports_disabled",
          "Live sports are not enabled in this server.",
        );
      return Response.json(
        await deps.playback.deps.catalog.sports.browse(
          url.searchParams,
          session.key + ":" + guildId,
          AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        ),
      );
    }
    if (url.pathname === "/api/library")
      return Response.json(deps.playback.deps.catalog.browse(url.searchParams));
    if (url.pathname === "/api/search") {
      const channel = deps.playback.deps.bot.webVoiceChannel(
        GuildIdSchema.parse(guildId),
        session.identity.userId,
      );
      const scope = {
        guildId,
        channelId: channel?.id ?? "web",
        userId: session.identity.userId,
      };
      return Response.json(
        await deps.playback.deps.catalog.search(
          url.searchParams,
          scope,
          session.key + ":" + guildId,
          AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        ),
      );
    }
    throw new WebError(404, "not_found", "This endpoint does not exist.");
  }

  function limitRequests(key: string): void {
    const now = Date.now();
    for (const [entryKey, entry] of requests)
      if (entry.resets <= now) requests.delete(entryKey);
    const entry = requests.get(key) ?? { count: 0, resets: now + 60_000 };
    entry.count += 1;
    if (requests.size >= 2000 && !requests.has(key))
      throw new WebError(429, "busy", "The remote is busy. Try again shortly.");
    requests.set(key, entry);
    if (entry.count > 120)
      throw new WebError(
        429,
        "rate_limit",
        "Too many requests. Try again shortly.",
      );
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok\n");
    if (url.pathname === "/readyz") {
      const ready = deps.playback.deps.bot.webReady();
      return new Response(ready ? "ready\n" : "starting\n", {
        status: ready ? 200 : 503,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/auth/discord/start")
      return auth.start();
    if (
      request.method === "GET" &&
      url.pathname === "/api/auth/discord/callback"
    )
      return await auth.callback(request);
    if (url.pathname.startsWith("/api/"))
      return await authenticated(request, url, auth.session(request));
    if (request.method !== "GET")
      throw new WebError(405, "method", "This method is not supported.");
    return await serveWebAsset(url, deps.assetsDir);
  }

  return async (request: Request): Promise<Response> => {
    let response: Response;
    try {
      response = await route(request);
    } catch (error) {
      if (error instanceof WebError)
        response = Response.json(
          { code: error.code, message: error.message },
          { status: error.status },
        );
      else if (error instanceof PlaybackCommandBoundaryError)
        response = Response.json(
          { code: "playback_denied", message: error.message },
          { status: 409 },
        );
      else {
        logger.error("web request failed", { layer: "web" });
        response = Response.json(
          {
            code: "unavailable",
            message:
              "Streambot could not complete this request. Try again shortly.",
          },
          { status: 503 },
        );
      }
    }
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("referrer-policy", "same-origin");
    response.headers.set(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' " +
        ARTWORK_HOSTS.map((host) => "https://" + host).join(" ") +
        "; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (new URL(request.url).pathname.startsWith("/api/"))
      response.headers.set("cache-control", "no-store");
    return response;
  };
}
