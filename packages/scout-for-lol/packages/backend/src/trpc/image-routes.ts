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
