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
} from "#lib/delivery/worker-rollout.ts";
import { run as runRootRelease } from "./root-release.ts";
import { run as runTofuApply } from "./tofu-apply.ts";

const ConnectionSchema = z.object({
  address: z.literal("temporal-server.temporal.svc.cluster.local:7233"),
});

async function command(argv: readonly string[]) {
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
      result = await runRootRelease(request.input);
      break;
    case "tofu-apply":
      result = await runTofuApply(request.input);
      break;
  }
  await Bun.write(
    Bun.stdout,
    `${DELIVERY_JOB_RESULT_PREFIX}${JSON.stringify(result)}\n`,
  );
}

await main();
