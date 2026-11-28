import type { Hono } from "hono";
import type { Principal } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { QualifyPendingBuild } from "#infrastructure/delivery-qualification.ts";
import type { QualificationRequest } from "#infrastructure/qualification.ts";
import { DeliveryError } from "#domain/error.ts";
import type { RetainableQualificationOutcome } from "./metrics.ts";

export function createRetainableQualifier(input: {
  qualifyInStore: (
    buildId: string,
    status: RetainableQualificationOutcome,
    actor: Principal,
    reason?: string,
  ) => Promise<{ status: RetainableQualificationOutcome }>;
  qualifyBuild: (
    request: QualificationRequest,
  ) => Promise<RetainableQualificationOutcome>;
  principal: Principal;
  requestId: string;
  recordOutcome: (outcome: RetainableQualificationOutcome) => void;
}): QualifyPendingBuild {
  type PipelineVerdict =
    | {
        kind: "settled";
        status: RetainableQualificationOutcome;
        reason?: string;
      }
    | { kind: "paused" };
  const byPipeline = new Map<string, Promise<PipelineVerdict>>();
  const byBuildId = new Map<string, Promise<RetainableQualificationOutcome>>();
  return (build) => {
    if (
      build.sourceKind !== "ci" ||
      build.ciUrl === null ||
      build.repositoryId === null ||
      build.pipelineNumber === null
    )
      return Promise.resolve("pending");
    const existing = byBuildId.get(build.id);
    if (existing !== undefined) return existing;
    const ciUrl = build.ciUrl;
    const pipelineKey = `${String(build.repositoryId)}:${String(build.pipelineNumber)}:${build.sourceRevision}:${ciUrl}`;
    let lookup = byPipeline.get(pipelineKey);
    if (lookup === undefined) {
      lookup = lookupPipelineVerdict(input, build, ciUrl);
      byPipeline.set(pipelineKey, lookup);
    }
    const settlement = settleBuildVerdict(input, build.id, lookup);
    byBuildId.set(build.id, settlement);
    return settlement;
  };
}

async function lookupPipelineVerdict(
  input: {
    qualifyBuild: (
      request: QualificationRequest,
    ) => Promise<RetainableQualificationOutcome>;
    principal: Principal;
    requestId: string;
  },
  build: { id: string; sourceRevision: string },
  ciUrl: string,
) {
  try {
    const status = await input.qualifyBuild({
      ciUrl,
      sourceRevision: build.sourceRevision,
      buildId: build.id,
      actor: input.principal,
      requestId: input.requestId,
    });
    return { kind: "settled" as const, status };
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "INVALID") {
      return {
        kind: "settled" as const,
        status: "failed" as const,
        reason: error.message,
      };
    }
    if (
      error instanceof DeliveryError &&
      (error.code === "PAUSED" || error.code === "UNAVAILABLE")
    ) {
      return { kind: "paused" as const };
    }
    throw error;
  }
}

async function settleBuildVerdict(
  input: {
    qualifyInStore: (
      buildId: string,
      status: RetainableQualificationOutcome,
      actor: Principal,
      reason?: string,
    ) => Promise<{ status: RetainableQualificationOutcome }>;
    principal: Principal;
    recordOutcome: (outcome: RetainableQualificationOutcome) => void;
  },
  buildId: string,
  lookup: Promise<
    | {
        kind: "settled";
        status: RetainableQualificationOutcome;
        reason?: string;
      }
    | { kind: "paused" }
  >,
): Promise<RetainableQualificationOutcome> {
  const verdict = await lookup;
  if (verdict.kind === "paused") {
    input.recordOutcome("pending");
    return "pending";
  }
  const settled = await input.qualifyInStore(
    buildId,
    verdict.status,
    input.principal,
    ...(verdict.reason === undefined ? [] : [verdict.reason]),
  );
  input.recordOutcome(settled.status);
  return settled.status;
}

export function registerQualificationRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  qualifyBuild: (
    input: QualificationRequest,
  ) => Promise<"pending" | "verified" | "failed">,
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
        buildId: build.id,
        actor: c.get("principal"),
        requestId: c.get("requestId"),
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
