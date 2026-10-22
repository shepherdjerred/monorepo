import { timingSafeEqual } from "node:crypto";
import { handleMinecraftRecovery } from "./minecraft-controller-recovery.ts";
import { Hono } from "hono";
import { z } from "zod";
import { MinecraftProducerError } from "./minecraft-controller-error.ts";
import type {
  DeploymentDetail,
  MinecraftRecoveryIntent,
} from "@shepherdjerred/delivery/contract";
import { deliveryOperationId } from "./selection.ts";
import {
  minecraftRuntimeImage,
  parseMinecraftEligibility,
} from "./minecraft.ts";
import { MinecraftControllerReceiptSchema } from "./minecraft-controller.ts";
import type {
  MinecraftControllerProcess,
  MinecraftControllerInput,
} from "./minecraft-controller-process.ts";

function requireLiveOwner(detail: DeploymentDetail, recover: boolean) {
  if (detail.environment.activeDeploymentId !== detail.deployment.id)
    throw new Error("Minecraft controller lost the exact PG deployment owner");
  if (recover) {
    if (
      !detail.deployment.recoveryRequired &&
      detail.deployment.status !== "running"
    )
      throw new Error(
        "Minecraft recovery has no quarantined maintenance owner",
      );
  } else if (
    detail.deployment.cancelRequested ||
    detail.deployment.status !== "running"
  )
    throw new Error(
      "Minecraft candidate canceled or superseded before maintenance",
    );
}
function requireRunningReceipt(
  detail: DeploymentDetail,
  requestId: string,
  expected?: unknown,
) {
  const stages = detail.stages.filter(
    (stage) =>
      /^minecraft-preservation-\d+$/u.test(stage.key) &&
      stage.status === "running",
  );
  if (stages.length !== 1 || stages[0]?.operationId !== requestId)
    throw new Error(
      "Minecraft maintenance has no unique recorded operation intent",
    );
  if (expected === undefined) return;
  const observed = MinecraftControllerReceiptSchema.parse(
    JSON.parse(stages[0].message),
  );
  if (
    JSON.stringify(observed) !==
    JSON.stringify(MinecraftControllerReceiptSchema.parse(expected))
  )
    throw new Error(
      "Native controller receipt was not recorded before maintenance effects",
    );
}

type ControllerOptions = {
  token: string;
  toolingRevision: string;
  /**
   * Admits the API's audience-bound report reader (TokenReview and
   * SubjectAccessReview). The executor token never reads a report (D5, I2).
   */
  authorizeReport: (token: string, requestId: string) => Promise<boolean>;
  process: Pick<MinecraftControllerProcess, "prepare" | "run">;
  load: (deploymentId: string) => Promise<DeploymentDetail>;
  admit: (deploymentId: string) => Promise<DeploymentDetail>;
  loadRecovery: (intentId: string) => Promise<{
    intent: MinecraftRecoveryIntent;
    deployment: DeploymentDetail;
  }>;
  longRequest?: (request: Request) => void;
};

const RequestBody = z
  .object({
    deploymentId: z.string().min(1).max(160),
    recoveryId: z.string().min(1).max(160).optional(),
  })
  .strict();

/** The frozen deployment's exact native request; callers select nothing. */
async function frozenRequest(
  options: ControllerOptions,
  requestId: string,
  body: z.infer<typeof RequestBody>,
) {
  const detail = await options.load(body.deploymentId);
  const image = minecraftRuntimeImage(detail);
  if (
    requestId !==
    deliveryOperationId(`${detail.deployment.id}:minecraft-preservation`)
  )
    throw new Error(
      "Minecraft request does not match frozen deployment identity",
    );
  const definition = detail.pipeline.definition;
  if (definition.kind !== "argocd" || definition.minecraftUpgrade === undefined)
    throw new Error("Missing reviewed Minecraft recipe");
  const artifact =
    detail.versionSet.components[definition.minecraftUpgrade.imageComponent];
  if (artifact === undefined)
    throw new Error("Missing exact candidate artifact");
  const input: MinecraftControllerInput = {
    requestId,
    deploymentId: detail.deployment.id,
    versionSetRevisionId: detail.deployment.versionSetRevisionId,
    toolingRevision: options.toolingRevision,
    candidateImage: image,
    runtimeDigests: artifact.runtimeDigests,
  };
  return { detail, image, input };
}

/** Only identity-bound fixed recipes are reachable; callers cannot select commands, credentials, paths or kubectl inputs. */
export function createMinecraftControllerServer(options: ControllerOptions) {
  z.string().min(16).parse(options.token);
  z.string()
    .regex(/^[a-f0-9]{40}$/u)
    .parse(options.toolingRevision);
  const app = new Hono();
  const active = new Set<string>();
  app.get("/healthz", (c) => c.json({ status: "ready" }));
  app.use("/requests/*", async (c, next) => {
    const authorization = Buffer.from(c.req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (
      authorization.length !== expected.length ||
      !timingSafeEqual(authorization, expected)
    )
      return c.json({ error: "Unauthorized" }, 401);
    await next();
    return;
  });
  // The read-only report settles recovery in the API, so only the API's own
  // reader identity may request it.
  app.post("/recovery-reports/:requestId", async (c) => {
    const requestId = z.uuid().parse(c.req.param("requestId"));
    const token = /^Bearer (\S+)$/u.exec(
      c.req.header("authorization") ?? "",
    )?.[1];
    if (token === undefined) return c.json({ error: "Unauthorized" }, 401);
    if (!(await options.authorizeReport(token, requestId)))
      return c.json({ error: "Forbidden" }, 403);
    const body = RequestBody.parse(await c.req.json());
    const { input } = await frozenRequest(options, requestId, body);
    return await handleMinecraftRecovery(options, input, {
      command: "report",
      recoveryId: body.recoveryId,
      active,
      request: c.req.raw,
    });
  });
  app.post("/requests/:requestId/:command", async (c) => {
    const requestId = z.uuid().parse(c.req.param("requestId"));
    const command = z
      .enum(["eligibility", "prepare", "verify", "prepare-recovery", "recover"])
      .parse(c.req.param("command"));
    const body = RequestBody.parse(await c.req.json());
    const { detail, image, input } = await frozenRequest(
      options,
      requestId,
      body,
    );
    if (command === "prepare-recovery" || command === "recover") {
      return await handleMinecraftRecovery(options, input, {
        command,
        recoveryId: body.recoveryId,
        active,
        request: c.req.raw,
      });
    }
    if (body.recoveryId !== undefined)
      throw new Error("Ordinary maintenance cannot borrow recovery authority");
    if (command === "eligibility") {
      if (
        detail.deployment.cancelRequested ||
        !["queued", "running"].includes(detail.deployment.status)
      )
        throw new Error(
          "Minecraft request is no longer eligible for execution",
        );
      return c.json(
        parseMinecraftEligibility(
          await options.process.run(input, "eligibility"),
        ),
      );
    }
    requireLiveOwner(detail, false);
    requireRunningReceipt(detail, requestId);
    const receipt = await options.process.prepare(input);
    if (command === "prepare") return c.json(receipt);
    // A fresh PG read fences cancellation, supersession and receipt persistence immediately before effect admission.
    const current = await options.admit(body.deploymentId);
    requireLiveOwner(current, false);
    requireRunningReceipt(current, requestId, receipt);
    if (minecraftRuntimeImage(current) !== image)
      throw new Error("Frozen Minecraft candidate changed before maintenance");
    if (active.has(requestId))
      return c.json(
        { error: "Exact maintenance request is already executing" },
        409,
      );
    options.longRequest?.(c.req.raw);
    active.add(requestId);
    try {
      return c.json(await options.process.run(input, command));
    } finally {
      active.delete(requestId);
    }
  });
  app.onError((error) =>
    Response.json(
      {
        error:
          "Minecraft maintenance failed; inspect the private durable request journal before recovery",
        ...(error instanceof MinecraftProducerError
          ? { diagnostic: error.diagnostic }
          : {}),
      },
      { status: 500 },
    ),
  );
  return app;
}
