/**
 * Non-tRPC GET routes that serve generated PNG charts for `<img src>` use in
 * the web app. Browsers can't attach a CSRF token to an image request, so
 * these are safe (read-only) GETs authorized purely by the `scout_session`
 * cookie + per-guild Administrator — the same `assertGuildAdmin` gate the
 * tRPC routers use, with the guild resolved from the row's `serverId`.
 *
 *   GET /api/competition/{competitionId}/leaderboard.png
 *   GET /api/report/{reportId}/runs/{runId}.png
 */

import { createContext } from "#src/trpc/context.ts";
import { assertGuildAdmin } from "#src/trpc/guild-guard.ts";
import { prisma } from "#src/database/index.ts";
import { loadLeaderboardImage } from "#src/storage/s3-leaderboard-image.ts";
import { loadReportRunImage } from "#src/storage/s3-report-run.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("http-image-routes");

const COMPETITION_LEADERBOARD_RE =
  /^\/api\/competition\/(\d+)\/leaderboard\.png$/;
const REPORT_RUN_RE = /^\/api\/report\/(\d+)\/runs\/(\d+)\.png$/;

type Cors = Record<string, string>;

function pngResponse(bytes: Buffer, cors: Cors): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
      ...cors,
    },
  });
}

function notFound(cors: Cors): Response {
  return new Response("Not Found", { status: 404, headers: cors });
}

/**
 * Returns a `Response` if `url` matches an image route, otherwise `null` so
 * the caller falls through to the next handler.
 */
export async function handleImageRoute(
  request: Request,
  url: URL,
  cors: Cors,
): Promise<Response | null> {
  if (url.pathname === "/api/summoner-icon") {
    return handleSummonerIcon(request, url, cors);
  }

  const competitionMatch = COMPETITION_LEADERBOARD_RE.exec(url.pathname);
  const reportRunMatch = REPORT_RUN_RE.exec(url.pathname);
  if (competitionMatch === null && reportRunMatch === null) {
    return null;
  }
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  const ctx = await createContext(request);
  if (ctx.user === null) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }
  const user = ctx.user;

  try {
    if (competitionMatch !== null) {
      const competitionId = Number(competitionMatch[1]);
      const competition = await prisma.competition.findUnique({
        where: { id: competitionId },
        select: { serverId: true },
      });
      if (competition === null) {
        return notFound(cors);
      }
      await assertGuildAdmin({ user, guildId: competition.serverId });
      const image = await loadLeaderboardImage(competitionId);
      return image === null ? notFound(cors) : pngResponse(image, cors);
    }

    if (reportRunMatch !== null) {
      const reportId = Number(reportRunMatch[1]);
      const runId = Number(reportRunMatch[2]);
      const run = await prisma.reportRun.findUnique({
        where: { id: runId },
        select: { reportId: true, serverId: true },
      });
      if (run?.reportId !== reportId) {
        return notFound(cors);
      }
      await assertGuildAdmin({ user, guildId: run.serverId });
      const image = await loadReportRunImage(reportId, runId);
      return image === null ? notFound(cors) : pngResponse(image, cors);
    }

    return null;
  } catch (error) {
    // assertGuildAdmin throws TRPCError (FORBIDDEN / NOT_FOUND) for callers who
    // aren't an admin of the owning guild. Don't leak which case it was.
    logger.warn("Image route authorization rejected:", error);
    return new Response("Forbidden", { status: 403, headers: cors });
  }
}

/** OP.GG static hosts we'll proxy summoner profile icons from. */
const ALLOWED_ICON_HOSTS = new Set(["opgg-static.akamaized.net"]);
const ICON_FETCH_TIMEOUT_MS = 5000;

/**
 * `GET /api/summoner-icon?u=<encoded url>` — proxy a League profile icon so the
 * browser never hotlinks OP.GG's CDN (referer/CORS, privacy). Session-gated and
 * strictly host-allowlisted (not an open proxy); only `image/*` is relayed.
 */
async function handleSummonerIcon(
  request: Request,
  url: URL,
  cors: Cors,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }
  const ctx = await createContext(request);
  if (ctx.user === null) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }

  const raw = url.searchParams.get("u");
  if (raw === null) return notFound(cors);
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return notFound(cors);
  }
  if (
    target.protocol !== "https:" ||
    !ALLOWED_ICON_HOSTS.has(target.hostname)
  ) {
    return new Response("Forbidden", { status: 403, headers: cors });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ICON_FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
    });
    if (!upstream.ok) return notFound(cors);
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return notFound(cors);
    const bytes = await upstream.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
        ...cors,
      },
    });
  } catch (error) {
    logger.warn("Summoner icon proxy failed:", error);
    return notFound(cors);
  } finally {
    clearTimeout(timer);
  }
}
