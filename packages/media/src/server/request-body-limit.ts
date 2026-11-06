import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_MIGRATION_BYTES } from "#shared/migration.ts";

const movieCaptionCandidate =
  /^\/api\/v2\/media\/[^/]+\/movie-editions\/[^/]+\/subtitle-replacements\/candidates$/;

/** Caption bytes have a separate bounded upload envelope; other commands retain their existing limit. */
export const mediaRequestBodyLimit: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "POST" && c.req.path === "/events/plex") return next();
  const upload =
    c.req.method === "POST" &&
    (c.req.path === "/api/v1/admin/subtitles" ||
      movieCaptionCandidate.test(c.req.path));
  return bodyLimit({
    maxSize:
      c.req.method === "POST" && c.req.path === "/api/v1/admin/migration"
        ? MAX_MIGRATION_BYTES
        : upload
          ? 12 * 1024 * 1024
          : 64 * 1024,
    onError: (context) =>
      context.json(
        {
          error: {
            code: "request_too_large",
            message: "Request exceeds this endpoint's size limit",
          },
        },
        413,
      ),
  })(c, next);
};
