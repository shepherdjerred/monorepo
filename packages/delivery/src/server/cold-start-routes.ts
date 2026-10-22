import type { Hono } from "hono";
import { DeliveryError } from "#domain/error.ts";
import { ReconcileAfterRestoreRequestSchema } from "#shared/model/route-contract.ts";
import type { Principal } from "#shared/contract.ts";
import {
  ColdStartReceiptSchema,
  ColdStartRequirementSchema,
  SettleRestoreHoldSchema,
} from "#shared/model/cold-start-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";

/** Cold start (section 6, X7): the snapshot the executor writes off-cluster and the restore check. */
export function registerColdStartRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  dependencies: {
    readApplication?: ApplicationReader;
    readColdStartSnapshot?: () => Promise<unknown>;
  },
) {
  app.get("/api/v1/deployments/:id/cold-start", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json(
      ColdStartRequirementSchema.parse(
        await delivery.coldStartRequirement(c.req.param("id")),
      ),
    );
  });
  app.post("/api/v1/deployments/:id/cold-start", async (c) =>
    c.json(
      await delivery.recordColdStartReceipt(
        c.req.param("id"),
        ColdStartReceiptSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/reconcile-after-restore", async (c) => {
    const readSnapshot = dependencies.readColdStartSnapshot;
    if (readSnapshot === undefined)
      throw new DeliveryError(
        "PAUSED",
        "No cold-start snapshot store is configured",
      );
    return c.json(
      await delivery.reconcileAfterRestore(
        ReconcileAfterRestoreRequestSchema.parse(await c.req.json()),
        c.get("principal"),
        {
          readSnapshot,
          ...(dependencies.readApplication === undefined
            ? {}
            : { readApplication: dependencies.readApplication }),
        },
      ),
    );
  });
  app.post("/api/v1/environments/:id/restore-hold/accept", async (c) =>
    c.json(
      await delivery.settleRestoreHold(
        c.req.param("id"),
        SettleRestoreHoldSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
}
