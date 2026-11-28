import type { Context, Hono } from "hono";
import { z } from "zod";
import { HISTORY_PAGE_LIMIT, type FlagsActor } from "./audit.ts";
import { archiveView, historyView, metadataView } from "./audit-views.ts";
import type { FlagsPrincipal } from "./auth.ts";
import type { FlagStore } from "./store.ts";

/** Management-app context: the authenticate middleware sets `principal`. */
export type FlagsManagementEnv = {
  Variables: { principal: FlagsPrincipal };
};

export const FLAGS_ACTOR_HEADER = "x-flags-actor";
const MACHINE_ACTOR_LABEL = /^[a-z0-9][a-z0-9._@-]{0,63}$/u;

const HistoryQuerySchema = z.strictObject({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_LIMIT).default(50),
});

/**
 * The audit actor for a management write. A human is the verified tailnet
 * login and any `X-Flags-Actor` header is ignored. A machine's label is
 * advisory (every token holder shares one credential): a well-formed header is
 * recorded as sent, otherwise the write proceeds as `unknown` with a warning.
 */
export function actorFor(c: Context<FlagsManagementEnv>): FlagsActor {
  const principal = c.get("principal");
  if (principal.kind === "human") return { kind: "human", id: principal.login };
  const label = c.req.header(FLAGS_ACTOR_HEADER);
  if (label !== undefined && MACHINE_ACTOR_LABEL.test(label)) {
    return { kind: "machine", id: label };
  }
  console.warn(
    JSON.stringify({
      level: "warn",
      message: "machine write without a valid actor label",
      service: "flags",
      reason: label === undefined ? "missing" : "invalid",
      method: c.req.method,
      path: c.req.path,
    }),
  );
  return { kind: "machine", id: "unknown" };
}

function deploymentId(catalog: string, stage: string): string {
  return `${catalog}/${stage}`;
}

/** Read-only audit views; mounted on the management app only. */
export function registerAuditRoutes(
  app: Hono<FlagsManagementEnv>,
  store: FlagStore,
): void {
  app.get("/v1/deployments/:catalog/:stage/flags/:key/history", (c) => {
    const id = deploymentId(c.req.param("catalog"), c.req.param("stage"));
    if (store.document(id) === undefined) {
      return c.json({ error: "unknown deployment" }, 404);
    }
    const query = HistoryQuerySchema.parse(c.req.query());
    return c.json(historyView(store, id, c.req.param("key"), query));
  });

  app.get("/v1/deployments/:catalog/:stage/metadata", (c) => {
    const document = store.document(
      deploymentId(c.req.param("catalog"), c.req.param("stage")),
    );
    return document === undefined
      ? c.json({ error: "unknown deployment" }, 404)
      : c.json(metadataView(store, document));
  });

  app.get("/v1/archive", (c) => c.json(archiveView(store)));
}
