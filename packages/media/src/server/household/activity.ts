import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { MediaApplication } from "#application/ports.ts";
import { LegacyActivityQuerySchema } from "#shared/legacy-activity/contract.ts";
import { parseInput } from "#server/validation.ts";

export function registerActivityRoute(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  media: Pick<MediaApplication, "activity" | "importedActivity">,
): void {
  app.get("/api/v1/activity", async (c) => {
    const actor = c.get("actor");
    const source = c.req.query("source");
    return source === undefined
      ? c.json(await media.activity(actor))
      : c.json(
          await media.importedActivity(
            actor,
            parseInput(LegacyActivityQuerySchema, {
              source,
              before: c.req.query("before"),
            }),
          ),
        );
  });
}
