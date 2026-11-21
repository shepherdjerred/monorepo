import { z } from "zod";
import {
  latencyBucket,
  usageAnalytics,
  type SearchSource,
} from "@shepherdjerred/streambot/observability/product-analytics.ts";
import { withSelectionKind } from "@shepherdjerred/streambot/observability/usage-context.ts";
import type {
  TelemetryOutcome,
  WebCommandAction,
  WebErrorCode,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import type { WebCommand } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  COOKIE_NAME,
  cookieValue,
} from "@shepherdjerred/streambot/web/server/auth.ts";
import type {
  WebSession,
  WebSessionStore,
} from "@shepherdjerred/streambot/web/server/session-store.ts";

// Everything here only reports usage: it never throws, never changes a response, and sends
// closed-set values keyed by a pseudonymous id (see `product-analytics.ts`).

const ItemsPageSchema = z.looseObject({ items: z.array(z.unknown()) });

/** Records one search with its latency bucket; the result and any failure are untouched. */
export async function observeSearch<T extends Response | null>(
  session: WebSession,
  source: SearchSource,
  run: () => Promise<{ response: T; hadResults: boolean }>,
): Promise<T> {
  const started = performance.now();
  const { response, hadResults } = await run();
  usageAnalytics().capture(session.identity.userId, {
    event: "streambot_search_performed",
    properties: {
      surface: "web",
      source,
      had_results: hadResults,
      latency_bucket: latencyBucket(performance.now() - started),
    },
  });
  return response;
}

/** A search whose response is a page of `items`: reports whether it had any. */
async function observeItemsPage(
  session: WebSession,
  source: SearchSource,
  handle: () => Promise<Response | null>,
): Promise<Response | null> {
  return await observeSearch(session, source, async () => {
    const response = await handle();
    if (response === null) return { response, hadResults: false };
    const page = ItemsPageSchema.safeParse(await response.clone().json());
    return {
      response,
      hadResults: page.success && page.data.items.length > 0,
    };
  });
}

/** Music catalog browsing with a query is the music search; everything else passes through. */
export async function observeMusicSearch(
  request: Request,
  url: URL,
  session: WebSession,
  handle: () => Promise<Response | null>,
): Promise<Response | null> {
  const searching =
    request.method === "GET" &&
    url.pathname === "/api/music/catalog" &&
    (url.searchParams.get("query") ?? "").trim() !== "";
  return searching
    ? await observeItemsPage(session, "music", handle)
    : await handle();
}

/** The unified search groups that report as a search, by the source each is counted under. */
const SEARCH_V2_SOURCES: Readonly<Record<string, SearchSource>> = {
  songs: "music",
  albums: "music",
  artists: "music",
  library: "library",
  videos: "candidates",
};

/**
 * A unified search with a query is one search. Only the closed source and result presence are
 * reported: never the query, its correction or any row.
 */
export async function observeSearchV2(
  request: Request,
  url: URL,
  session: WebSession,
  handle: () => Promise<Response | null>,
): Promise<Response | null> {
  const source = SEARCH_V2_SOURCES[url.searchParams.get("kind") ?? ""];
  const searching =
    request.method === "GET" &&
    url.pathname === "/api/search/v2" &&
    (url.searchParams.get("q") ?? "").trim() !== "";
  return searching && source !== undefined
    ? await observeItemsPage(session, source, handle)
    : await handle();
}

/** The signed-in user is whoever owns the session the callback just created. */
export function recordSignIn(store: WebSessionStore, response: Response): void {
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const token = cookieValue(
    new Request("http://streambot.invalid/", { headers: { cookie: cookies } }),
    COOKIE_NAME,
  );
  const signedIn = token === null ? null : store.read(token);
  if (signedIn === null) return;
  usageAnalytics().capture(signedIn.identity.userId, {
    event: "streambot_web_signed_in",
    properties: { outcome: "success" },
  });
}

/** Runs a command with its selection kind visible to the play observer; reports started stations. */
export async function runObservedCommand(
  session: WebSession,
  command: WebCommand,
  execute: () => Promise<Response>,
): Promise<Response> {
  const response = await (command.action === "play"
    ? withSelectionKind(command.selection.kind, execute)
    : execute());
  if (command.action === "station" && command.mode !== "off")
    usageAnalytics().capture(session.identity.userId, {
      event: "streambot_station_started",
      properties: { kind: command.mode, scope: command.scope ?? "room" },
    });
  return response;
}

/** Plays are reported by the play observer, so only the other commands are reported here. */
export function recordCommandUsage(
  session: WebSession,
  command: {
    action: WebCommandAction;
    outcome: TelemetryOutcome;
    code: WebErrorCode;
  },
): void {
  if (command.action === "play") return;
  usageAnalytics().capture(session.identity.userId, {
    event: "streambot_command_used",
    properties: { surface: "web", ...command },
  });
}
