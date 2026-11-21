import { serveWebAsset } from "./assets.ts";
import { webSchedules } from "./schedules.ts";
import { browseSports } from "./sports-request.ts";
import {
  CommandSchema,
  type WebCommand,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { GuildIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { WebAuth, type WebBootstrap } from "./auth.ts";
import type { WebSession, WebSessionStore } from "./session-store.ts";
import type { WebPlayback } from "./playback.ts";
import { WebActions } from "./actions.ts";
import { WebMusic } from "./music.ts";
import { WebError, requestInput } from "./errors.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { withWebSpan } from "@shepherdjerred/streambot/observability/tracing.ts";
import {
  webCommandAction,
  webCommandDurationSeconds,
  webCommandsTotal,
  webLoginsTotal,
  webRequestDurationSeconds,
  webRequestsTotal,
  webStatusClass,
  type WebLoginOutcome,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import {
  classifyWebFailure,
  outcomeForStatus,
  roundMilliseconds,
  webMethod,
  type WebFailure,
} from "./telemetry.ts";
import { usageAnalytics } from "@shepherdjerred/streambot/observability/product-analytics.ts";
import {
  observeMusicSearch,
  observeSearch,
  recordCommandUsage,
  recordSignIn,
  runObservedCommand,
} from "./usage/observation.ts";
import { ARTWORK_HOSTS } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
import {
  webFailureDiagnostic,
  webFailureEndpoint,
} from "./failure-diagnostic.ts";

const log = logger.child("web");

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
  plexPostersEnabled?: (guildId: string, userId: string) => Promise<boolean>;
}) {
  const auth = new WebAuth({
    bootstrap: deps.bootstrap,
    applicationId: deps.applicationId,
    store: deps.store,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  const actions = new WebActions(deps.playback);
  const music = new WebMusic(deps.playback);
  const requests = new Map<
    string,
    { count: number; artwork: number; resets: number }
  >();

  async function authenticated(
    request: Request,
    url: URL,
    session: WebSession,
  ): Promise<Response> {
    limitRequests(
      session.key,
      url.pathname === "/api/artwork" || url.pathname === "/api/music/artwork",
    );
    if (request.method === "POST") auth.mutation(request, session);
    if (
      ["/api/sports/schedules", "/api/sports/schedules/cancel"].includes(
        url.pathname,
      ) &&
      ["GET", "POST"].includes(request.method)
    )
      return await webSchedules(request, session, deps.playback);
    if (url.pathname === "/api/auth/logout" && request.method === "POST")
      return auth.logout(request);
    if (url.pathname === "/api/me" && request.method === "GET") {
      return Response.json({
        user: session.identity,
        guilds: deps.playback.deps.bot.webGuilds(session.identity.guildIds),
        csrfToken: auth.csrfToken(request, session),
        analyticsId:
          usageAnalytics().analyticsId(session.identity.userId) ?? null,
      });
    }
    const musicResponse = await observeMusicSearch(request, url, session, () =>
      music.handle(request, url, session),
    );
    if (musicResponse !== null) return musicResponse;
    if (request.method === "POST" && url.pathname === "/api/subtitles")
      return Response.json(
        await actions.subtitles(
          session,
          await readCommand(request),
          request.signal,
        ),
      );
    if (request.method === "POST" && url.pathname === "/api/commands")
      return await observedCommand(request, session);
    if (request.method !== "GET")
      throw new WebError(405, "method", "This method is not supported.");
    return await browseMedia(request, url, session);
  }

  /** One span, metric sample and log line per command; the failure still propagates unchanged. */
  async function observedCommand(
    request: Request,
    session: WebSession,
  ): Promise<Response> {
    const started = performance.now();
    return await withWebSpan("streambot.web.command", {}, async (span) => {
      let input: WebCommand | undefined;
      let failure: WebFailure | undefined;
      try {
        input = await readCommand(request);
        span.setAttribute("streambot.web.action", input.action);
        const command = input;
        return await runObservedCommand(session, command, () =>
          executeCommand(session, command, request.signal),
        );
      } catch (error) {
        failure = classifyWebFailure(error, request.signal);
        throw error;
      } finally {
        const action = webCommandAction(input?.action ?? "invalid");
        const outcome = failure?.outcome ?? "ok";
        const code = failure?.code ?? "ok";
        const transport =
          input?.action === "play"
            ? (input.transport ?? "unspecified")
            : "unspecified";
        webCommandsTotal.inc({ action, transport, outcome });
        recordCommandUsage(session, { action, outcome, code });
        webCommandDurationSeconds.observe(
          { action },
          (performance.now() - started) / 1000,
        );
        span.setAttributes({
          "streambot.web.action": action,
          "streambot.web.outcome": outcome,
          "streambot.web.code": code,
        });
        if (failure?.kind === "unexpected")
          span.setStatus({ code: SpanStatusCode.ERROR });
        log.info("web command", {
          action,
          ...(input?.action === "play"
            ? {
                placement: input.placement,
                selection_kind: input.selection.kind,
              }
            : {}),
          transport,
          outcome,
          code,
          duration_ms: roundMilliseconds(started),
        });
      }
    });
  }

  async function executeCommand(
    session: WebSession,
    input: WebCommand,
    signal: AbortSignal,
  ) {
    if (input.action === "play") {
      const result = await music.execute(session, input, signal);
      if (result !== null) return Response.json(result);
    }
    const result = await actions.execute(session, input, signal);
    music.cancelRoom(session, input);
    return Response.json(result);
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
    const plexEnabled =
      (url.pathname === "/api/artwork" || url.pathname === "/api/library") &&
      ((await deps.plexPostersEnabled?.(guildId, session.identity.userId)) ??
        false);
    if (url.pathname === "/api/artwork")
      return await deps.playback.deps.catalog.artwork.resolve(
        url.searchParams.get("id") ?? "",
        plexEnabled,
        request.signal,
      );
    if (url.pathname === "/api/sports") {
      return await browseSports({
        request,
        session,
        playback: deps.playback,
        guildId,
      });
    }
    if (url.pathname === "/api/library")
      return Response.json(
        deps.playback.deps.catalog.browse(url.searchParams, plexEnabled),
      );
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
      return await observeSearch(session, "candidates", async () => {
        const results = await deps.playback.deps.catalog.search(
          url.searchParams,
          scope,
          session.key + ":" + guildId,
          AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        );
        return {
          response: Response.json(results),
          hadResults: results.length > 0,
        };
      });
    }
    if (url.pathname === "/api/history") {
      if (!(await deps.playback.historyEnabled(session, guildId)))
        throw new WebError(
          403,
          "history_disabled",
          "Playback history is not enabled here.",
        );
      return Response.json(
        await deps.playback.history.browse({
          params: url.searchParams,
          userId: session.identity.userId,
          owner: session.key + ":" + guildId,
          catalog: deps.playback.deps.catalog,
          sportsEnabled: await deps.playback.sportsEnabled(session, guildId),
          requester: (guild, user) =>
            deps.playback.requesterName(session, guild, user),
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(30_000),
          ]),
        }),
      );
    }
    throw new WebError(404, "not_found", "This endpoint does not exist.");
  }

  function limitRequests(key: string, artwork: boolean): void {
    const now = Date.now();
    for (const [entryKey, entry] of requests)
      if (entry.resets <= now) requests.delete(entryKey);
    const entry = requests.get(key) ?? {
      count: 0,
      artwork: 0,
      resets: now + 60_000,
    };
    if (artwork) entry.artwork += 1;
    else entry.count += 1;
    if (requests.size >= 2000 && !requests.has(key))
      throw new WebError(429, "busy", "The remote is busy. Try again shortly.");
    requests.set(key, entry);
    if (artwork ? entry.artwork > 600 : entry.count > 120)
      throw new WebError(
        429,
        "rate_limit",
        "Too many requests. Try again shortly.",
      );
  }

  async function observedLogin(request: Request): Promise<Response> {
    let outcome: WebLoginOutcome = "failed";
    try {
      const response = await auth.callback(request);
      outcome =
        response.headers.get("location") === "/?login=cancelled"
          ? "cancelled"
          : "success";
      if (outcome === "success") recordSignIn(deps.store, response);
      return response;
    } catch (error) {
      if (error instanceof WebError && error.code === "oauth_state")
        outcome = "invalid_state";
      throw error;
    } finally {
      webLoginsTotal.inc({ outcome });
      log.info("web login", { outcome });
    }
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
      return auth.start(request);
    if (
      request.method === "GET" &&
      url.pathname === "/api/auth/discord/callback"
    )
      return await observedLogin(request);
    if (url.pathname.startsWith("/api/"))
      return await authenticated(request, url, auth.session(request));
    if (request.method !== "GET")
      throw new WebError(405, "method", "This method is not supported.");
    return await serveWebAsset(url, deps.assetsDir);
  }

  async function respond(
    request: Request,
  ): Promise<{ response: Response; failure: WebFailure | undefined }> {
    let response: Response;
    let failure: WebFailure | undefined;
    try {
      response = await route(request);
    } catch (error) {
      failure = classifyWebFailure(error, request.signal);
      if (failure.kind === "unexpected" || failure.kind === "aborted") {
        // A client that left mid-request is reported by the request line, not as an error.
        if (failure.kind === "unexpected")
          logger.error("web request failed", {
            layer: "web",
            endpoint: webFailureEndpoint(request),
            failure: webFailureDiagnostic(error),
          });
        response = Response.json(
          {
            code: "unavailable",
            message:
              "Streambot could not complete this request. Try again shortly.",
          },
          { status: 503 },
        );
      } else if (error instanceof WebError || error instanceof MusicError)
        response = Response.json(
          { code: error.code, message: error.message },
          { status: error.status },
        );
      else
        response = Response.json(
          {
            code: "playback_denied",
            message: error instanceof Error ? error.message : "",
          },
          { status: 409 },
        );
    }
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("referrer-policy", "same-origin");
    response.headers.set(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' " +
        ARTWORK_HOSTS.map((host) => "https://" + host).join(" ") +
        "; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (
      new URL(request.url).pathname.startsWith("/api/") &&
      !response.headers.has("cache-control")
    )
      response.headers.set("cache-control", "no-store");
    return { response, failure };
  }

  return async (request: Request): Promise<Response> => {
    // Health, readiness and static assets are not API traffic and stay untraced.
    if (!new URL(request.url).pathname.startsWith("/api/")) {
      const { response } = await respond(request);
      return response;
    }
    const endpoint = webFailureEndpoint(request);
    const method = webMethod(request.method);
    const started = performance.now();
    return await withWebSpan(
      "streambot.web.request",
      { "streambot.web.route": endpoint, "http.request.method": method },
      async (span) => {
        const { response, failure } = await respond(request);
        const status = response.status;
        const code = failure?.code ?? (status < 400 ? "ok" : "other");
        const outcome = failure?.outcome ?? outcomeForStatus(status);
        const statusClass =
          failure?.kind === "aborted" ? "aborted" : webStatusClass(status);
        webRequestsTotal.inc({
          route: endpoint,
          status_class: statusClass,
          code,
        });
        webRequestDurationSeconds.observe(
          { route: endpoint },
          (performance.now() - started) / 1000,
        );
        annotateRequestSpan(span, { status, code, outcome, failure });
        const traceId = span.spanContext().traceId;
        if (trace.isSpanContextValid(span.spanContext()))
          response.headers.set("x-trace-id", traceId);
        const meta = {
          route: endpoint,
          method,
          status,
          code,
          outcome,
          duration_ms: roundMilliseconds(started),
        };
        if (status >= 500 && failure?.kind !== "aborted")
          log.warn("web request", meta);
        else log.info("web request", meta);
        return response;
      },
    );
  };
}

function annotateRequestSpan(
  span: Span,
  input: {
    status: number;
    code: string;
    outcome: string;
    failure: WebFailure | undefined;
  },
): void {
  span.setAttributes({
    "http.response.status_code": input.status,
    "streambot.web.code": input.code,
    "streambot.web.outcome": input.outcome,
  });
  if (input.status >= 500 && input.failure?.kind !== "aborted")
    span.setStatus({ code: SpanStatusCode.ERROR });
}
