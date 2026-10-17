import { createHash, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { PlexWatchHint } from "#shared/plex-events/contract.ts";
import { PlexEventRequestError, readPlexPayload } from "./payload.ts";

export type PlexEventIngress = {
  accept: (hint: PlexWatchHint) => Promise<void>;
};
export type PlexEventRouteDependencies = {
  ingress: PlexEventIngress;
  enabled: () => Promise<boolean>;
  secret: string | undefined;
};

const digest = (value: string) => createHash("sha256").update(value).digest();
function authorized(request: Request, secret: string): boolean {
  const keys = new URL(request.url).searchParams.getAll("key");
  const key = keys.length === 1 ? keys[0] : undefined;
  const candidate = key !== undefined && key.length <= 256 ? key : "";
  return (
    timingSafeEqual(digest(candidate), digest(secret)) && candidate.length > 0
  );
}

export function registerPlexEventRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  dependencies: PlexEventRouteDependencies,
  onError: (error: Error, requestId: string) => void,
) {
  app.post("/events/plex", async (c) => {
    try {
      if (!(await dependencies.enabled()) || dependencies.secret === undefined)
        return c.json({ error: "Event receiver unavailable" }, 503);
      if (!authorized(c.req.raw, dependencies.secret))
        return c.json({ error: "Unauthorized" }, 401);
      const hint = await readPlexPayload(c.req.raw);
      if (hint !== null) await dependencies.ingress.accept(hint);
      return c.json({ status: "accepted" });
    } catch (error) {
      if (error instanceof PlexEventRequestError)
        return c.json({ error: error.message }, error.status);
      // Never forward exception messages, causes, request objects or payloads.
      onError(new Error("Plex event processing failed"), c.get("requestId"));
      return c.json({ error: "Event processing unavailable" }, 503);
    }
  });
}
