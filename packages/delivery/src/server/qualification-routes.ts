import type { Hono } from "hono";
import type { Principal } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { requireScope } from "#infrastructure/auth.ts";
import { DeliveryError } from "#domain/error.ts";

export function registerQualificationRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  qualifyBuild: (input: {
    ciUrl: string;
    sourceRevision: string;
  }) => Promise<"pending" | "verified" | "failed">,
) {
  app.get("/api/v1/qualification/pending", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json(await delivery.pendingQualification());
  });
  app.post("/api/v1/builds/:id/qualify", async (c) => {
    requireScope(c.get("principal"), "execute");
    const build = await delivery.build(c.req.param("id"));
    if (
      build.sourceKind !== "ci" ||
      build.ciUrl === null ||
      build.repositoryId === null ||
      build.pipelineNumber === null
    )
      throw new DeliveryError(
        "INVALID",
        "External artifact qualification requires its independent source verifier",
      );
    await delivery.markQualificationAttempt(build.id);
    try {
      const status = await qualifyBuild({
        ciUrl: build.ciUrl,
        sourceRevision: build.sourceRevision,
      });
      return c.json(
        await delivery.qualify(build.id, status, c.get("principal")),
      );
    } catch (error) {
      if (error instanceof DeliveryError && error.code === "INVALID")
        return c.json(
          await delivery.qualify(
            build.id,
            "failed",
            c.get("principal"),
            error.message,
          ),
        );
      throw error;
    }
  });
}
