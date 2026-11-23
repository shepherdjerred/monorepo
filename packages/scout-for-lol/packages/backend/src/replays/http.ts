import { z } from "zod";
import type { PublicReplayDescriptor } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import {
  describePublicReplay,
  findPublicMatchReplays,
  findPublicReplay,
  unobservedReplaySupport,
  type ReplaySupportResolver,
  type StoredPublicReplay,
} from "./catalog.ts";
import {
  openReplayContent,
  ReplayContentUnavailable,
  type ReplayByteRange,
} from "./content.ts";
import { readPublicReplayTimeline } from "./timeline.ts";

const ReplayIdSchema = z.uuid();
const MatchQuerySchema = z.strictObject({
  platformId: z.string().regex(/^[A-Z]{2,4}\d{0,2}$/),
  gameId: z.string().regex(/^\d{1,32}$/),
});
const replayPath = /^\/api\/replays\/([^/]+)(?:\/(content|timeline))?$/;
const metadataHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: { ...metadataHeaders, "Content-Type": "application/json" },
  });
}

export type ReplayHttpDependencies = {
  readonly findById: typeof findPublicReplay;
  readonly findByMatch: typeof findPublicMatchReplays;
  readonly openContent: typeof openReplayContent;
  readonly readTimeline: typeof readPublicReplayTimeline;
};
const dependencies: ReplayHttpDependencies = {
  findById: findPublicReplay,
  findByMatch: findPublicMatchReplays,
  openContent: openReplayContent,
  readTimeline: readPublicReplayTimeline,
};

/** Reject multiple or malformed ranges rather than buffering multipart bodies. */
export function parseReplayRange(
  value: string,
  bytes: number,
): ReplayByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (match === null) return null;
  const [, first, last] = match;
  if (first === "" && last === "") return null;
  if (first === "") {
    const suffix = Number(last);
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { start: Math.max(0, bytes - suffix), end: bytes - 1 }
      : null;
  }
  const start = Number(first);
  const end = last === "" ? bytes - 1 : Number(last);
  return !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= bytes ||
    end < start
    ? null
    : { start, end: Math.min(end, bytes - 1) };
}

function matchesEtag(header: string | null, etag: string): boolean {
  return (
    header?.split(",").some((value) => {
      const tag = value.trim();
      return tag === "*" || tag === etag || tag === `W/${etag}`;
    }) ?? false
  );
}

async function replayContentResponse(
  request: Request,
  replay: StoredPublicReplay,
  deps: ReplayHttpDependencies,
): Promise<Response> {
  const bytes = Number(replay.bytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    throw new Error("Completed replay has an invalid recorded byte length");
  const etag = `"${replay.digest}"`;
  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/vnd.riot.rofl",
    "Content-Disposition": `inline; filename="replay-${replay.id}.rofl"`,
    "Accept-Ranges": "bytes",
    ETag: etag,
  });
  if (matchesEtag(request.headers.get("If-None-Match"), etag))
    return new Response(null, { status: 304, headers });
  const ifRange = request.headers.get("If-Range");
  const requestedRange =
    ifRange !== null && ifRange !== etag ? null : request.headers.get("Range");
  const range =
    requestedRange === null ? null : parseReplayRange(requestedRange, bytes);
  if (range === null && requestedRange !== null) {
    headers.set("Content-Range", `bytes */${bytes.toString()}`);
    headers.set("Cache-Control", "no-store");
    return new Response(null, { status: 416, headers });
  }
  headers.set(
    "Content-Length",
    (range === null ? bytes : range.end - range.start + 1).toString(),
  );
  if (range !== null)
    headers.set(
      "Content-Range",
      `bytes ${range.start.toString()}-${range.end.toString()}/${bytes.toString()}`,
    );
  const status = range === null ? 200 : 206;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  try {
    const stream = await deps.openContent(replay, range, request.signal);
    return new Response(stream, { status, headers });
  } catch (error) {
    if (!(error instanceof ReplayContentUnavailable)) throw error;
    return jsonResponse(request, { error: "replay_storage_unavailable" }, 503);
  }
}

/** Anonymous reads expose only stored replay artifacts, never client credentials. */
export async function handleReplayRoute(
  request: Request,
  url: URL,
  resolveSupport: ReplaySupportResolver = unobservedReplaySupport,
  deps: ReplayHttpDependencies = dependencies,
): Promise<Response | null> {
  const match = replayPath.exec(url.pathname);
  if (match === null && url.pathname !== "/api/replays") return null;
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, {
      status: 405,
      headers: { ...metadataHeaders, Allow: "GET, HEAD" },
    });
  if (match === null) {
    const query = MatchQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!query.success || url.searchParams.size !== 2)
      return jsonResponse(request, { error: "invalid_match_identity" }, 400);
    const candidates = await deps.findByMatch(
      query.data.platformId,
      query.data.gameId,
    );
    let selected: PublicReplayDescriptor | null = null;
    for (const candidate of candidates) {
      const descriptor = await describePublicReplay(candidate, resolveSupport);
      selected ??= descriptor;
      if (descriptor.playback.status === "available") {
        selected = descriptor;
        break;
      }
    }
    const availability = { replay: selected };
    return jsonResponse(request, availability);
  }
  const replayId = ReplayIdSchema.safeParse(match[1]);
  const replay = replayId.success ? await deps.findById(replayId.data) : null;
  if (replay === null)
    return jsonResponse(request, { error: "replay_not_found" }, 404);
  switch (match[2]) {
    case "content":
      return await replayContentResponse(request, replay, deps);
    case "timeline":
      return await replayTimelineResponse(request, replay, deps);
    case undefined:
    default:
      return jsonResponse(
        request,
        await describePublicReplay(replay, resolveSupport),
      );
  }
}

async function replayTimelineResponse(
  request: Request,
  replay: StoredPublicReplay,
  deps: ReplayHttpDependencies,
): Promise<Response> {
  const timeline =
    request.method === "HEAD"
      ? null
      : await deps.readTimeline(replay, request.signal);
  return jsonResponse(request, { timeline });
}
