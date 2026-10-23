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
  verifyDeliveryWorkerImages,
  WorkerImageProofInputSchema,
} from "#lib/delivery/workers/worker-image-proof.ts";
import { renderControlPlaneTemplates } from "#lib/delivery/workers/worker-control-plane.ts";
import { withWorkerCandidateCheckout } from "#lib/delivery/workers/worker-candidate-checkout.ts";
import { WorkerDeploymentRolloutTargetSchema } from "#lib/worker-deployment-target.ts";
import { runTestStage } from "./test-stage.ts";

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
  if (
    request.recipe === "platform-recovery" &&
    Bun.env["NODE_EXTRA_CA_CERTS"] === undefined
  ) {
    const ca = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
    if (!(await Bun.file(ca).exists()))
      throw new Error("Platform recovery requires its mounted Kubernetes CA");
    if (process.execve === undefined)
      throw new Error("Platform recovery requires process execve support");
    process.execve(
      process.execPath,
      [process.execPath, ...process.argv.slice(1)],
      {
        ...Bun.env,
        NODE_EXTRA_CA_CERTS: ca,
      },
    );
  }
  const checkout = await command(["git", "rev-parse", "HEAD"]);
  if (checkout.stdout.trim() !== request.sourceRevision)
    throw new Error(
      "Delivery Job checkout differs from qualified source revision",
    );
  const toplevel = await command(["git", "rev-parse", "--show-toplevel"]);
  // Worker candidates reuse or share this prepared checkout's objects and cache.
  const candidateCheckout = (
    snapshot: z.infer<typeof WorkerRolloutSnapshotSchema>,
  ) => ({
    sourceRevision: snapshot.deployment.workerSnapshot?.candidateBuildId,
    target: WorkerDeploymentRolloutTargetSchema.parse(
      snapshot.deployment.workerSnapshot?.target,
    ),
    executor: {
      root: toplevel.stdout.trim(),
      revision: request.sourceRevision,
    },
  });
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
      const { prepareDeliveryWorkerRollout } =
        await import("#lib/delivery/workers/worker-rollout.ts");
      const input = z
        .object({
          detail: WorkerRolloutSnapshotSchema,
          connection: ConnectionSchema,
        })
        .strict()
        .parse(request.input);
      result = await withWorkerCandidateCheckout(
        candidateCheckout(input.detail),
        (candidate) =>
          prepareDeliveryWorkerRollout(
            input.detail,
            input.connection,
            command,
            candidate,
          ),
      );
      break;
    }
    case "worker-step": {
      const { stepDeliveryWorkerRollout } =
        await import("#lib/delivery/workers/worker-rollout.ts");
      const input = z
        .object({
          detail: WorkerRolloutSnapshotSchema,
          connection: ConnectionSchema,
          plan: WorkerRolloutPlanSchema,
          action: WorkerRolloutActionSchema,
        })
        .strict()
        .parse(request.input);
      result = await withWorkerCandidateCheckout(
        candidateCheckout(input.detail),
        (candidate) => stepDeliveryWorkerRollout(input, command, candidate),
      );
      break;
    }
    case "test": {
      result = await runTestStage(request);
      break;
    }
    case "tofu-apply": {
      const { run } = await import("./tofu-apply.ts");
      result = await run(request);
      break;
    }
    case "tofu-plan": {
      const { run } = await import("./tofu-plan.ts");
      result = await run(request);
      break;
    }
    case "control-plane": {
      const { run } = await import("./control-plane.ts");
      result = await run(request);
      break;
    }
    case "platform-recovery": {
      const { run } = await import("./platform-recovery.ts");
      result = await run(request);
      break;
    }
  }
  await Bun.write(
    Bun.stdout,
    `${DELIVERY_JOB_RESULT_PREFIX}${JSON.stringify(result)}\n`,
  );
}

await main();
