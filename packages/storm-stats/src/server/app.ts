import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  ActivityGroupSchema,
  IngestBatchSchema,
  PlatformSchema,
  PlayerSortFieldSchema,
  type ActivityGroup,
  type ViewerInfo,
  type ViewerRole,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import { MAX_INGEST_BODY_BYTES, verifyBearerToken } from "./config.ts";
import {
  classifyMetricRoute,
  createStormStatsMetrics,
  type ListenerLabel,
  type StormStatsMetrics,
} from "./metrics.ts";
import type { PlayersQueryOptions } from "./queries-players.ts";
import type { StaffQueryFilters } from "./queries-staff-filters.ts";
import { DEFAULT_CLIENT_ROOT, attachSpaStaticRoutes } from "./static.ts";
import type { StormStatsStore } from "./store.ts";

export type ReadAppDependencies = {
  readonly store: StormStatsStore;
  readonly publicEnabled: () => Promise<boolean>;
  readonly metrics?: StormStatsMetrics;
  readonly clientRoot?: string;
  readonly now?: () => Date;
};

export type IngestAppDependencies = {
  readonly store: StormStatsStore;
  readonly ingestToken: string;
  readonly ingestEnabled: () => Promise<boolean>;
  readonly metrics?: StormStatsMetrics;
  readonly maxBodyBytes?: number;
};

function attachRequestMetrics(
  app: Hono,
  metrics: StormStatsMetrics,
  listener: ListenerLabel,
): void {
  app.use("*", async (c, next) => {
    const startedNs = Bun.nanoseconds();
    const route = classifyMetricRoute(c.req.path);
    await next();
    const elapsedSeconds = (Bun.nanoseconds() - startedNs) / 1_000_000_000;
    metrics.httpRequestDurationSeconds.observe(
      { listener, method: c.req.method, route },
      elapsedSeconds,
    );
    metrics.httpRequestsTotal.inc({
      listener,
      method: c.req.method,
      route,
      status: String(c.res.status),
    });
  });
}

function attachErrorHandler(app: Hono): void {
  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        level: "error",
        service: "storm-stats",
        path: c.req.path,
        error: error.message,
      }),
    );
    return c.json({ error: "Internal server error" }, 500);
  });
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

function parseOptionalFloat(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptionalBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const lower = raw.trim().toLowerCase();
  if (lower === "true" || lower === "1") {
    return true;
  }
  return lower === "false" || lower === "0" ? false : undefined;
}

function parseOrderParam(raw: string | undefined): "asc" | "desc" | undefined {
  return raw === "asc" || raw === "desc" ? raw : undefined;
}

function parsePlayersQuery(c: Context): PlayersQueryOptions {
  const search = c.req.query("search") ?? c.req.query("q");
  const sortRaw = c.req.query("sort") ?? c.req.query("sortBy");
  const sortParsed = PlayerSortFieldSchema.safeParse(sortRaw);
  const order = parseOrderParam(
    c.req.query("order") ?? c.req.query("sortDir") ?? c.req.query("dir"),
  );
  const groupRaw = c.req.query("activityGroup") ?? c.req.query("group");
  const groupParsed = ActivityGroupSchema.safeParse(groupRaw);
  const platformParsed = PlatformSchema.safeParse(c.req.query("platform"));
  const onlineOnly = parseOptionalBool(c.req.query("online"));
  const town = c.req.query("town");
  const page = parseOptionalInt(c.req.query("page"));
  const pageSize = parseOptionalInt(
    c.req.query("pageSize") ?? c.req.query("limit"),
  );

  return {
    ...(search === undefined ? {} : { search }),
    ...(sortParsed.success ? { sort: sortParsed.data } : {}),
    ...(order === undefined ? {} : { order }),
    ...(groupParsed.success ? { activityGroup: groupParsed.data } : {}),
    ...(platformParsed.success ? { platform: platformParsed.data } : {}),
    ...(onlineOnly === undefined ? {} : { onlineOnly }),
    ...(town === undefined ? {} : { town }),
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize }),
  };
}

function parseActivityGroupList(
  raw: string | undefined,
): ActivityGroup[] | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const groups: ActivityGroup[] = [];
  for (const token of raw.split(",")) {
    const parsed = ActivityGroupSchema.safeParse(token.trim());
    if (parsed.success) {
      groups.push(parsed.data);
    }
  }
  return groups.length > 0 ? groups : undefined;
}

function parseStaffIdentityFilters(c: Context): StaffQueryFilters {
  const search = c.req.query("search") ?? c.req.query("q");
  const activityGroups = parseActivityGroupList(
    c.req.query("activityGroups") ??
      c.req.query("activityGroup") ??
      c.req.query("group"),
  );
  const platformParsed = PlatformSchema.safeParse(c.req.query("platform"));
  const primaryGroup = c.req.query("primaryGroup");
  const countryCode = c.req.query("countryCode") ?? c.req.query("country");
  const joinAddress = c.req.query("joinAddress");
  const town = c.req.query("town");
  const registeredAfter = c.req.query("registeredAfter");
  const registeredBefore = c.req.query("registeredBefore");
  const lastSeenAfter = c.req.query("lastSeenAfter");
  const lastSeenBefore = c.req.query("lastSeenBefore");

  return {
    ...(search === undefined ? {} : { search }),
    ...(activityGroups === undefined ? {} : { activityGroups }),
    ...(platformParsed.success ? { platform: platformParsed.data } : {}),
    ...(primaryGroup === undefined ? {} : { primaryGroup }),
    ...(countryCode === undefined ? {} : { countryCode }),
    ...(joinAddress === undefined ? {} : { joinAddress }),
    ...(town === undefined ? {} : { town }),
    ...(registeredAfter === undefined ? {} : { registeredAfter }),
    ...(registeredBefore === undefined ? {} : { registeredBefore }),
    ...(lastSeenAfter === undefined ? {} : { lastSeenAfter }),
    ...(lastSeenBefore === undefined ? {} : { lastSeenBefore }),
  };
}

function parseStaffNumericFilters(c: Context): StaffQueryFilters {
  const minActiveHours = parseOptionalFloat(
    c.req.query("minActiveHours") ?? c.req.query("minPlaytimeHours"),
  );
  const maxActiveHours = parseOptionalFloat(
    c.req.query("maxActiveHours") ?? c.req.query("maxPlaytimeHours"),
  );
  const minSessions = parseOptionalInt(c.req.query("minSessions"));
  const minActivityIndex = parseOptionalFloat(c.req.query("minActivityIndex"));
  const seenWithinDays = parseOptionalFloat(
    c.req.query("seenWithinDays") ?? c.req.query("lastSeenDays"),
  );
  const registeredWithinDays = parseOptionalFloat(
    c.req.query("registeredWithinDays") ?? c.req.query("firstSeenDays"),
  );
  const hasBounces = parseOptionalBool(
    c.req.query("hasBounces") ?? c.req.query("hasBounce"),
  );
  const online = parseOptionalBool(c.req.query("online"));
  const sortParsed = PlayerSortFieldSchema.safeParse(
    c.req.query("sort") ?? c.req.query("sortBy"),
  );
  const order = parseOrderParam(c.req.query("order") ?? c.req.query("dir"));
  const limit = parseOptionalInt(c.req.query("limit"));

  return {
    ...(minActiveHours === undefined ? {} : { minActiveHours }),
    ...(maxActiveHours === undefined ? {} : { maxActiveHours }),
    ...(minSessions === undefined ? {} : { minSessions }),
    ...(minActivityIndex === undefined ? {} : { minActivityIndex }),
    ...(seenWithinDays === undefined ? {} : { seenWithinDays }),
    ...(registeredWithinDays === undefined ? {} : { registeredWithinDays }),
    ...(hasBounces === undefined ? {} : { hasBounces }),
    ...(online === undefined ? {} : { online }),
    ...(sortParsed.success ? { sort: sortParsed.data } : {}),
    ...(order === undefined ? {} : { order }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function registerObservabilityRoutes(
  app: Hono,
  store: StormStatsStore,
  metrics: StormStatsMetrics,
): void {
  app.get("/healthz", (c) => c.text("ok", 200));
  app.get("/readyz", (c) =>
    store.ping() ? c.text("ready", 200) : c.text("not ready", 503),
  );
  app.get("/metrics", async () => {
    metrics.playersTotal.set(store.playerCount());
    metrics.onlinePlayersGauge.set(store.onlineCount());
    return new Response(await metrics.register.metrics(), {
      status: 200,
      headers: { "Content-Type": metrics.register.contentType },
    });
  });
}

function registerV1ReadRoutes(
  app: Hono,
  deps: ReadAppDependencies,
  viewer: ViewerRole,
): void {
  const nowFn = deps.now ?? (() => new Date());

  app.get("/api/v1/viewer", async (c) => {
    const publicEnabled = await deps.publicEnabled();
    const payload: ViewerInfo = {
      role: viewer,
      serverName: deps.store.serverName(),
      publicEnabled,
      generatedAt: nowFn().toISOString(),
    };
    return c.json(payload, 200);
  });

  if (viewer === "public") {
    app.use("/api/v1/*", async (c, next) => {
      if (c.req.path === "/api/v1/viewer") {
        await next();
        return;
      }
      if (!(await deps.publicEnabled())) {
        return c.json({ error: "Public stats temporarily unavailable" }, 503);
      }
      await next();
      return;
    });
  }

  app.get("/api/v1/overview", (c) =>
    c.json(deps.store.getOverview(nowFn()), 200),
  );

  app.get("/api/v1/activity", (c) =>
    c.json(deps.store.getActivity(nowFn()), 200),
  );

  app.get("/api/v1/players", (c) =>
    c.json(deps.store.getPlayers(parsePlayersQuery(c), viewer, nowFn()), 200),
  );

  app.get("/api/v1/players/:id", (c) => {
    const profile = deps.store.getPlayerProfile(c.req.param("id"), nowFn());
    return profile === null
      ? c.json({ error: "Player not found" }, 404)
      : c.json(profile, 200);
  });

  app.get("/api/v1/pvp", (c) =>
    c.json(deps.store.getPvpOverview(nowFn()), 200),
  );

  app.get("/api/v1/gameplay", (c) =>
    c.json(deps.store.getGameplayOverview(nowFn()), 200),
  );
}

/**
 * Public read-only listener (`:7420`).
 * Never mounts `/api/staff/*` or `/api/v1/ingest`, and never includes `staff`
 * fields on directory rows.
 */
export function createPublicApp(deps: ReadAppDependencies): Hono {
  const app = new Hono();
  const metrics = deps.metrics ?? createStormStatsMetrics();
  const clientRoot = deps.clientRoot ?? DEFAULT_CLIENT_ROOT;

  attachErrorHandler(app);
  attachRequestMetrics(app, metrics, "public");
  app.use("*", secureHeaders());

  registerObservabilityRoutes(app, deps.store, metrics);
  registerV1ReadRoutes(app, deps, "public");

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  attachSpaStaticRoutes(app, clientRoot);

  return app;
}

/**
 * Tailscale-only Staff Admin listener (`:7421`).
 * Serves all v1 read endpoints with `viewer.role = "staff"` (unaffected by
 * `publicEnabled`), plus `/api/staff/*` diagnostics and the SPA frontend.
 */
export function createStaffApp(deps: ReadAppDependencies): Hono {
  const app = new Hono();
  const metrics = deps.metrics ?? createStormStatsMetrics();
  const clientRoot = deps.clientRoot ?? DEFAULT_CLIENT_ROOT;
  const nowFn = deps.now ?? (() => new Date());

  attachErrorHandler(app);
  attachRequestMetrics(app, metrics, "staff");
  app.use("*", secureHeaders());

  registerObservabilityRoutes(app, deps.store, metrics);
  registerV1ReadRoutes(app, deps, "staff");

  app.get("/api/staff/network", (c) =>
    c.json(deps.store.getStaffNetwork(nowFn()), 200),
  );

  app.get("/api/staff/bounces", (c) =>
    c.json(deps.store.getStaffBounces(nowFn()), 200),
  );

  app.get("/api/staff/query", (c) =>
    c.json(
      deps.store.getStaffQuery(
        { ...parseStaffIdentityFilters(c), ...parseStaffNumericFilters(c) },
        nowFn(),
      ),
      200,
    ),
  );

  app.get("/api/staff/players/:id", (c) => {
    const overlay = deps.store.getStaffPlayerOverlay(
      c.req.param("id"),
      nowFn(),
    );
    return overlay === null
      ? c.json({ error: "Player not found" }, 404)
      : c.json(overlay, 200);
  });

  app.get("/api/staff/players/:id/raw", (c) => {
    const raw = deps.store.getStaffPlayerRaw(c.req.param("id"), nowFn());
    return raw === null
      ? c.json({ error: "Player not found" }, 404)
      : c.json(raw, 200);
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  attachSpaStaticRoutes(app, clientRoot);

  return app;
}

type BoundedBodyResult =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "too_large" };

async function readBoundedBodyText(
  request: Request,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { kind: "too_large" };
    }
  }
  if (request.body === null) {
    return { kind: "ok", text: "" };
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const decodedSegments: string[] = [];
  let received = 0;
  try {
    for (
      let step = await reader.read();
      !step.done;
      step = await reader.read()
    ) {
      received += step.value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      decodedSegments.push(decoder.decode(step.value, { stream: true }));
    }
    decodedSegments.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  return { kind: "ok", text: decodedSegments.join("") };
}

/**
 * Internal cluster-only bearer-authenticated ingest listener (`:7422`).
 */
export function createIngestApp(deps: IngestAppDependencies): Hono {
  const app = new Hono();
  const metrics = deps.metrics ?? createStormStatsMetrics();
  const maxBytes = deps.maxBodyBytes ?? MAX_INGEST_BODY_BYTES;

  attachErrorHandler(app);
  attachRequestMetrics(app, metrics, "ingest");

  app.get("/healthz", (c) => c.text("ok", 200));

  app.post("/api/v1/ingest", async (c) => {
    const authorized = verifyBearerToken(
      c.req.header("authorization"),
      deps.ingestToken,
    );
    if (!authorized) {
      metrics.ingestBatchesTotal.inc({ result: "unauthorized" });
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!(await deps.ingestEnabled())) {
      metrics.ingestBatchesTotal.inc({ result: "disabled" });
      return c.json({ error: "Ingest temporarily disabled" }, 503);
    }

    const bodyResult = await readBoundedBodyText(c.req.raw, maxBytes);
    if (bodyResult.kind === "too_large") {
      metrics.ingestBatchesTotal.inc({ result: "too_large" });
      return c.json({ error: "Payload exceeds maximum size limit" }, 413);
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(bodyResult.text);
    } catch {
      metrics.ingestBatchesTotal.inc({ result: "invalid" });
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = IngestBatchSchema.safeParse(rawJson);
    if (!parsed.success) {
      metrics.ingestBatchesTotal.inc({ result: "invalid" });
      return c.json(
        {
          error: "Invalid ingest batch payload",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    }

    const ack = deps.store.ingestBatch(parsed.data);
    metrics.ingestBatchesTotal.inc({ result: "accepted" });
    if (ack.acceptedEvents > 0) {
      metrics.ingestEventsTotal.inc(
        { outcome: "accepted" },
        ack.acceptedEvents,
      );
    }
    if (ack.duplicateEvents > 0) {
      metrics.ingestEventsTotal.inc(
        { outcome: "duplicate" },
        ack.duplicateEvents,
      );
    }
    metrics.playersTotal.set(deps.store.playerCount());

    return c.json(ack, 200);
  });

  app.all("*", (c) => c.json({ error: "Not found" }, 404));

  return app;
}
