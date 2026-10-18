import {
  WorkerRolloutSnapshotSchema,
  WorkerRolloutPlanSchema,
  WorkerRolloutActionSchema,
} from "@shepherdjerred/delivery/contract";
import { z } from "zod";
import {
  DeliveryJobRequestSchema,
  DELIVERY_JOB_RESULT_PREFIX,
} from "#shared/delivery-job.ts";
import {
  prepareDeliveryWorkerRollout,
  stepDeliveryWorkerRollout,
} from "#lib/delivery/workers/worker-rollout.ts";
import { run as runRootRelease } from "./root-release.ts";
import { run as runTofuApply } from "./tofu-apply.ts";
import { run as runTofuPlan } from "./tofu-plan.ts";
import { run as runControlPlane } from "./control-plane.ts";
import { run as runPlatformRecovery } from "./platform-recovery.ts";
import {
  verifyDeliveryWorkerImages,
  WorkerImageProofInputSchema,
} from "#lib/delivery/workers/worker-image-proof.ts";
import { renderControlPlaneTemplates } from "#lib/delivery/workers/worker-control-plane.ts";

const ConnectionSchema = z.object({
  address: z.literal(
    "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
  ),
});

async function command(argv: readonly string[]) {
  if (argv[0] === "toolkit" && argv[1] === "prom" && argv[2] === "query") {
    const expression = z.string().min(1).parse(argv[3]);
    const url = new URL(
      "http://prometheus-kube-prometheus-prometheus.prometheus:9090/api/v1/query",
    );
    url.searchParams.set("query", expression);
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Worker metrics query failed");
    return { stdout: await response.text(), stderr: "" };
  }
  const child = Bun.spawn([...argv], {
    stdout: "pipe",
    stderr: "pipe",
    env: Object.fromEntries(
      Object.entries(Bun.env).filter(
        ([key]) => key !== "OP_SERVICE_ACCOUNT_TOKEN",
      ),
    ),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw new Error("Reviewed worker proof or routing command failed");
  return { stdout, stderr };
}

async function main() {
  const raw = Bun.env["DELIVERY_JOB_REQUEST"];
  if (raw === undefined) throw new Error("Delivery Job input is missing");
  const request = DeliveryJobRequestSchema.parse(JSON.parse(raw));
  const checkout = await command(["git", "rev-parse", "HEAD"]);
  if (checkout.stdout.trim() !== request.sourceRevision)
    throw new Error(
      "Delivery Job checkout differs from qualified source revision",
    );
  let result: unknown;
  switch (request.recipe) {
    case "worker-images": {
      const input = WorkerImageProofInputSchema.parse(request.input);
      await verifyDeliveryWorkerImages(input.detail, command);
      result = {
        verified: true,
        controlPlaneTemplates:
          input.controlPlane === null
            ? []
            : await renderControlPlaneTemplates(input.controlPlane, command),
      };
      break;
    }
    case "worker-preflight": {
      const input = z
        .object({
          detail: WorkerRolloutSnapshotSchema,
          connection: ConnectionSchema,
        })
        .strict()
        .parse(request.input);
      result = await prepareDeliveryWorkerRollout(
        input.detail,
        input.connection,
        command,
      );
      break;
    }
    case "worker-step": {
      const input = z
        .object({
          detail: WorkerRolloutSnapshotSchema,
          connection: ConnectionSchema,
          plan: WorkerRolloutPlanSchema,
          action: WorkerRolloutActionSchema,
        })
        .strict()
        .parse(request.input);
      result = await stepDeliveryWorkerRollout(input, command);
      break;
    }
    case "root-release":
      result = await runRootRelease(request);
      break;
    case "tofu-apply":
      result = await runTofuApply(request);
      break;
    case "tofu-plan":
      result = await runTofuPlan(request);
      break;
    case "control-plane":
      result = await runControlPlane(request);
      break;
    case "platform-recovery":
      result = await runPlatformRecovery(request);
      break;
  }
  await Bun.write(
    Bun.stdout,
    `${DELIVERY_JOB_RESULT_PREFIX}${JSON.stringify(result)}\n`,
  );
}

await main();
