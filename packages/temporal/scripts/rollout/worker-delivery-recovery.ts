import { Connection } from "@temporalio/client";
import { KubeConfig } from "@kubernetes/client-node";
import { z } from "zod";
import { WorkerRecoveryContextSchema } from "@shepherdjerred/delivery/contract";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { deliveryUrl } from "@shepherdjerred/toolkit/lib/delivery/client.ts";
import {
  parseFlagArguments,
  requiredParsedArgument,
  requiredEnvironment,
} from "#scripts/cli-arguments.ts";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { createDeliveryArgoReader } from "#lib/delivery/argo-transport.ts";
import { workerRecoveryEffects } from "#lib/delivery/workers/worker-recovery-effects.ts";
import { proveSettledWorkerRecovery } from "#lib/delivery/workers/worker-recovery.ts";
import { resolveOperatorTemporalApiKey } from "./temporal-operator-credentials.ts";

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
  await resolveCredentials([
    "DELIVERY_EXECUTOR_TOKEN",
    "ARGOCD_AUTH_TOKEN",
    "GRAFANA_API_KEY",
  ]);
  await resolveOperatorTemporalApiKey();
  Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: requiredEnvironment(Bun.env, "TEMPORAL_ADDRESS"),
    }),
  );
  const kubernetes = new KubeConfig();
  kubernetes.loadFromDefault();
  kubernetes.setCurrentContext(context);
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
            readArgo: createDeliveryArgoReader({
              server: "https://argocd.sjer.red",
              token: requiredEnvironment(Bun.env, "ARGOCD_AUTH_TOKEN"),
            }),
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
