import type { Hono } from "hono";
import { z } from "zod";
import type { NotificationApplication } from "#application/notification-ports.ts";
import type { MediaActor } from "#application/auth.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "./validation.ts";

export function registerNotificationActions(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  notifications: NotificationApplication,
): void {
  app.post("/api/v1/notifications/:id/retry", async (c) => {
    const input = parseInput(
      z.object({ expectedVersion: z.number().int().nonnegative() }).strict(),
      await readJson(c.req.raw),
    );
    return c.json(
      await notifications.retryDelivery(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        c.req.param("id"),
        input.expectedVersion,
      ),
      202,
    );
  });
  app.post("/api/v1/notifications/:id/reconcile", async (c) => {
    const input = parseInput(
      z
        .object({
          expectedVersion: z.number().int().nonnegative(),
          receipt: z.string().min(1).max(1000).optional(),
        })
        .strict(),
      await readJson(c.req.raw),
    );
    return c.json(
      await notifications.reconcileDelivery(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        c.req.param("id"),
        {
          expectedVersion: input.expectedVersion,
          ...(input.receipt === undefined ? {} : { receipt: input.receipt }),
        },
      ),
      202,
    );
  });
}
