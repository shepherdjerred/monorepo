import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { registerAdminRoutes, type AdminApplication } from "./admin-routes.ts";
import { registerPlexRoutes, type PlexAdministration } from "./plex-routes.ts";
import {
  registerMigrationRoutes,
  type MigrationAdministration,
} from "./migration-routes.ts";
import { MAX_MIGRATION_BYTES } from "#shared/migration.ts";
import {
  registerPlexExclusionRoutes,
  type PlexExclusionAdministration,
} from "./plex-exclusion-routes.ts";
import {
  registerNumberingRoutes,
  type NumberingAdministration,
} from "./numbering-routes.ts";
import { z } from "zod";
import type { MediaActor, MediaAuth } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type {
  CatalogApplication,
  MediaApplication,
} from "#application/ports.ts";
import { CreateRequestSchema, MediaActionSchema } from "#shared/contract.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson, readCookie } from "./validation.ts";
import type { NotificationApplication } from "#application/notification-ports.ts";
import {
  SaveQualityProfileSchema,
  UpdateNotificationPreferencesSchema,
} from "#shared/api.ts";

export type MediaAppDependencies = {
  auth: Pick<
    MediaAuth,
    "start" | "poll" | "authenticate" | "verifyCsrf" | "logout"
  >;
  media: MediaApplication;
  catalog: CatalogApplication;
  notifications: NotificationApplication;
  admin: AdminApplication;
  plexAdmin: PlexAdministration;
  numberingAdmin: NumberingAdministration;
  migrationAdmin: MigrationAdministration;
  plexExclusionAdmin: PlexExclusionAdministration;
  publicOrigin: string;
  requestsEnabled: () => Promise<boolean>;
  onError: (error: Error, requestId: string) => void;
  afterWrite?: () => Promise<void>;
};

const CancelSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
const RestrictSchema = CancelSchema.extend({ restricted: z.boolean() });
const AdoptSchema = z
  .object({
    kind: z.enum(["movie", "series"]),
    externalId: z.number().int().positive(),
  })
  .strict();

async function notifyCommittedWrite(
  dependencies: MediaAppDependencies,
  requestId: string,
): Promise<void> {
  try {
    await dependencies.afterWrite?.();
  } catch {
    dependencies.onError(new Error("Outbox dispatch deferred"), requestId);
  }
}

export function createMediaApp(dependencies: MediaAppDependencies) {
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  const origin = new URL(dependencies.publicOrigin).origin;
  const secure = origin.startsWith("https:");
  const sessionName = secure ? "__Host-media-session" : "media-session";
  const loginName = secure ? "__Host-media-login" : "media-login";
  const csrfName = secure ? "__Host-media-csrf" : "media-csrf";
  const cookie = {
    secure,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  } satisfies Parameters<typeof setCookie>[3];
  app.use(secureHeaders());
  app.use(async (c, next) => {
    const upload =
      c.req.method === "POST" && c.req.path === "/api/v1/admin/subtitles";
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
  });
  app.use(async (c, next) => {
    const id = crypto.randomUUID();
    c.set("requestId", id);
    c.header("X-Request-ID", id);
    c.header("Cache-Control", "no-store");
    await next();
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      c.res.status >= 200 &&
      c.res.status < 300 &&
      dependencies.afterWrite !== undefined
    ) {
      void notifyCommittedWrite(dependencies, id);
    }
  });
  app.onError((error, c) => {
    if (error instanceof MediaError)
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    dependencies.onError(error, c.get("requestId"));
    return c.json(
      {
        error: {
          code: "internal_error",
          message: "The operation failed; use the request ID for investigation",
        },
      },
      500,
    );
  });
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("/api/*", async (c, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      c.req.header("Origin") !== origin
    )
      throw new MediaError(
        "origin_rejected",
        "Request origin is not allowed",
        403,
      );
    await next();
  });
  app.post("/api/v1/auth/plex/start", async (c) => {
    const login = await dependencies.auth.start();
    setCookie(c, loginName, login.browserToken, {
      ...cookie,
      expires: new Date(login.expiresAt),
    });
    return c.json(
      {
        id: login.id,
        authorizationUrl: login.authorizationUrl,
        expiresAt: login.expiresAt,
      },
      201,
    );
  });
  // Polling changes session state, so it is POST and checks the browser origin.
  app.post("/api/v1/auth/plex/poll/:id", async (c) => {
    const result = await dependencies.auth.poll(
      c.req.param("id"),
      readCookie(c.req.raw, loginName) ?? "",
    );
    if (!result) return c.json({ status: "pending" }, 202);
    setCookie(c, sessionName, result.sessionToken, {
      ...cookie,
      expires: result.expiresAt,
    });
    setCookie(c, csrfName, result.csrfToken, {
      ...cookie,
      httpOnly: false,
      expires: result.expiresAt,
    });
    deleteCookie(c, loginName, cookie);
    return c.json({
      status: "authenticated",
      user: result.actor,
      csrfToken: result.csrfToken,
    });
  });

  app.use("/api/*", async (c, next) => {
    const session = await dependencies.auth.authenticate(
      readCookie(c.req.raw, sessionName),
    );
    c.set("actor", session.actor);
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method))
      dependencies.auth.verifyCsrf(
        c.req.header("X-CSRF-Token"),
        session.csrfHash,
      );
    await next();
  });
  app.get("/api/v1/me", (c) => c.json(c.get("actor")));
  app.post("/api/v1/auth/logout", async (c) => {
    await dependencies.auth.logout(readCookie(c.req.raw, sessionName) ?? "");
    deleteCookie(c, sessionName, cookie);
    deleteCookie(c, csrfName, { ...cookie, httpOnly: false });
    return c.body(null, 204);
  });
  const requireRequestsEnabled = async () => {
    if (!(await dependencies.requestsEnabled()))
      throw new MediaError(
        "requests_disabled",
        "New media requests are disabled during rollout",
        503,
      );
  };
  app.get("/api/v1/catalog/search", async (c) =>
    c.json(
      await dependencies.catalog.search(
        parseInput(z.string().min(1).max(200), c.req.query("q")),
      ),
    ),
  );
  app.get("/api/v1/catalog/:kind/:id", async (c) =>
    c.json(
      await dependencies.catalog.details(
        parseInput(z.enum(["movie", "series"]), c.req.param("kind")),
        parseInput(z.coerce.number().int().positive(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/catalog/adopt", async (c) => {
    await requireRequestsEnabled();
    const input = parseInput(AdoptSchema, await readJson(c.req.raw));
    if (c.get("actor").restricted)
      throw new MediaError(
        "requests_restricted",
        "This account cannot add catalog items",
        403,
      );
    return c.json(
      await dependencies.catalog.adopt(input.kind, input.externalId),
      201,
    );
  });
  app.get("/api/v1/requests", async (c) =>
    c.json(await dependencies.media.listRequests(c.get("actor"))),
  );
  app.post("/api/v1/requests", async (c) => {
    await requireRequestsEnabled();
    const input = parseInput(CreateRequestSchema, await readJson(c.req.raw));
    if (
      input.requesterUserId !== undefined &&
      input.requesterUserId !== c.get("actor").id
    )
      await dependencies.plexAdmin.refreshProfileAccess(
        c.get("actor"),
        input.requesterUserId,
      );
    return c.json(
      await dependencies.media.createRequest(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
      ),
      202,
    );
  });
  app.post("/api/v1/requests/:id/cancel", async (c) => {
    const input = parseInput(CancelSchema, await readJson(c.req.raw));
    return c.json(
      await dependencies.media.cancelRequest(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        c.req.param("id"),
        input.expectedVersion,
      ),
    );
  });
  app.get("/api/v1/media/:id", async (c) =>
    c.json(
      await dependencies.media.getMedia(c.get("actor"), c.req.param("id")),
    ),
  );
  app.get("/api/v1/media/:id/children", async (c) => {
    const detail = await dependencies.media.getMedia(
      c.get("actor"),
      c.req.param("id"),
    );
    return c.json(detail.children);
  });
  app.post("/api/v1/media/:id/actions", async (c) => {
    const input = parseInput(MediaActionSchema, await readJson(c.req.raw));
    if (input.action === "retry" || input.action === "select_release")
      await requireRequestsEnabled();
    return c.json(
      await dependencies.media.act(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        c.req.param("id"),
        input,
      ),
      202,
    );
  });
  app.get("/api/v1/media/:id/releases", async (c) =>
    c.json(
      await dependencies.media.releases(c.get("actor"), c.req.param("id")),
    ),
  );
  app.get("/api/v1/activity", async (c) =>
    c.json(await dependencies.media.activity(c.get("actor"))),
  );
  app.get("/api/v1/removals", async (c) =>
    c.json(await dependencies.media.removals(c.get("actor"))),
  );
  app.get("/api/v1/notifications", async (c) =>
    c.json(await dependencies.media.notifications(c.get("actor"))),
  );
  app.get("/api/v1/profiles", async (c) =>
    c.json(await dependencies.media.profiles(c.get("actor"))),
  );
  app.get("/api/v1/profile-defaults", async (c) =>
    c.json(await dependencies.media.profileDefaults(c.get("actor"))),
  );
  app.put("/api/v1/admin/profile-defaults/:kind", async (c) =>
    c.json(
      await dependencies.media.setProfileDefault(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.enum(["movie", "series"]), c.req.param("kind")),
        parseInput(
          z
            .object({
              expectedVersion: z.number().int().nonnegative(),
              profileId: z.string().min(1),
            })
            .strict(),
          await readJson(c.req.raw),
        ),
      ),
    ),
  );
  app.get("/api/v1/admin/users", async (c) =>
    c.json(await dependencies.media.listUsers(c.get("actor"))),
  );
  app.patch("/api/v1/admin/users/:id", async (c) => {
    const input = parseInput(RestrictSchema, await readJson(c.req.raw));
    return c.json(
      await dependencies.media.restrictUser(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        c.req.param("id"),
        input,
      ),
    );
  });
  app.post("/api/v1/admin/profiles", async (c) =>
    c.json(
      await dependencies.media.saveProfile(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(SaveQualityProfileSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
  app.put("/api/v1/media/:id/profile", async (c) =>
    c.json(
      await dependencies.media.assignProfile(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        c.req.param("id"),
        parseInput(
          CancelSchema.extend({ profileId: z.string().min(1) }),
          await readJson(c.req.raw),
        ),
      ),
      202,
    ),
  );
  app.get("/api/v1/notifications/preferences", async (c) =>
    c.json(await dependencies.notifications.preferences(c.get("actor"))),
  );
  app.put("/api/v1/notifications/preferences", async (c) =>
    c.json(
      await dependencies.notifications.updatePreferences(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(
          UpdateNotificationPreferencesSchema,
          await readJson(c.req.raw),
        ),
      ),
    ),
  );
  app.post("/api/v1/notifications/email", async (c) => {
    const input = parseInput(
      z.object({ email: z.email() }).strict(),
      await readJson(c.req.raw),
    );
    return c.json(
      await dependencies.notifications.requestEmailVerification(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input.email,
      ),
      202,
    );
  });
  app.post("/api/v1/notifications/email/verify", async (c) => {
    const input = parseInput(
      z.object({ token: z.string().min(32).max(200) }).strict(),
      await readJson(c.req.raw),
    );
    return c.json(
      await dependencies.notifications.verifyEmail(c.get("actor"), input.token),
    );
  });
  app.post("/api/v1/notifications/discord/start", async (c) =>
    c.json(await dependencies.notifications.startDiscordLink(c.get("actor"))),
  );
  app.post("/api/v1/notifications/discord/complete", async (c) =>
    c.json(
      await dependencies.notifications.completeDiscordLink(
        c.get("actor"),
        parseInput(
          z
            .object({
              code: z.string().min(1).max(1000),
              state: z.string().min(32).max(200),
              issuer: z.literal("https://discord.com"),
            })
            .strict(),
          await readJson(c.req.raw),
        ),
      ),
    ),
  );
  app.delete("/api/v1/notifications/discord", async (c) =>
    c.json(await dependencies.notifications.unlinkDiscord(c.get("actor"))),
  );
  registerAdminRoutes(app, dependencies.admin);
  registerPlexRoutes(app, dependencies.plexAdmin);
  registerNumberingRoutes(app, dependencies.numberingAdmin);
  registerMigrationRoutes(app, dependencies.migrationAdmin);
  registerPlexExclusionRoutes(app, dependencies.plexExclusionAdmin);
  app.notFound((c) =>
    c.json(
      { error: { code: "not_found", message: "Endpoint does not exist" } },
      404,
    ),
  );
  return app;
}
