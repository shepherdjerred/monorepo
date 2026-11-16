import { z } from "zod";
import {
  WorkerRecoveryContextSchema,
  WorkerRecoveryObservationSchema,
} from "@shepherdjerred/delivery/contract";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { deliveryUrl } from "@shepherdjerred/toolkit/lib/delivery/client.ts";
import {
  parseFlagArguments,
  requiredParsedArgument,
} from "#scripts/cli-arguments.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { workerRecoveryEffects } from "#lib/delivery/workers/worker-recovery-effects.ts";
import { proveSettledWorkerRecovery } from "#lib/delivery/workers/worker-recovery.ts";
import { openOperatorRecovery } from "./temporal-operator-credentials.ts";

/** Outage path: same readonly verifier and CAS, without a healthy Temporal Workflow/Activity worker. */
async function main(): Promise<void> {
  const flags = parseFlagArguments(
    process.argv.slice(2),
    new Set(["--intent", "--url", "--context"]),
  );
  const id = requiredParsedArgument(flags, "--intent");
  const context = z
    .literal("admin@torvalds")
    .parse(requiredParsedArgument(flags, "--context"));
  Bun.env["DELIVERY_API_URL"] = deliveryUrl(
    requiredParsedArgument(flags, "--url"),
  );
  await resolveCredentials(["DELIVERY_EXECUTOR_TOKEN", "GRAFANA_API_KEY"]);
  const { kubernetes, connection } = await openOperatorRecovery(context);
  try {
    const path = `worker-recovery/${encodeURIComponent(id)}`;
    const requested = await deliveryRequest(path, WorkerRecoveryContextSchema);
    if (requested.intent.status !== "pending")
      throw new Error("Recovery intent is not pending");
    const proof = await connection.withDeadline(
      Date.now() + 20 * 60_000,
      async () =>
        await proveSettledWorkerRecovery(
          requested,
          workerRecoveryEffects({
            connection,
            kubernetes,
            // The API reads the target with its own identity (D5, I2).
            observe: async () =>
              await deliveryRequest(
                `${path}/observation`,
                WorkerRecoveryObservationSchema,
              ),
            pollerRunner: async (command) => {
              const child = Bun.spawn([...command], {
                stdout: "pipe",
                stderr: "ignore",
                env: {
                  PATH: Bun.env["PATH"],
                  HOME: Bun.env["HOME"],
                  GRAFANA_API_KEY: Bun.env["GRAFANA_API_KEY"],
                },
              });
              const output = await new Response(child.stdout).text();
              if ((await child.exited) !== 0)
                throw new Error("Readonly operator poller inspection failed");
              return { stdout: output, stderr: "" };
            },
          }),
        ),
    );
    await deliveryRequest(`${path}/complete`, z.unknown(), proof);
    console.warn(
      JSON.stringify({
        intentId: id,
        status: "succeeded",
        originalDeploymentResult: "unchanged",
      }),
    );
  } finally {
    await connection.close();
  }
}

try {
  await main();
} catch {
  console.error(
    "Independent worker recovery proof failed; ownership retained. Inspect the exact recovery intent and native operation receipts.",
  );
  process.exitCode = 1;
}
