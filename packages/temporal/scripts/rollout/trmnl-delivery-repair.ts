import { Client, Connection } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";
import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { deliveryUrl } from "@shepherdjerred/toolkit/lib/delivery/client.ts";
import { createTrmnlPluginClient } from "@shepherdjerred/ops-clients/trmnl.ts";
import { createTrmnlArchiveReader } from "@shepherdjerred/ops-clients/trmnl-archive.ts";
import {
  parseFlagArguments,
  requiredParsedArgument,
  requiredEnvironment,
} from "#scripts/cli-arguments.ts";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { createDeliveryArgoReader } from "#lib/delivery/argo-transport.ts";
import { closedPlatformWorkflow } from "#lib/delivery/platform/recovery/native-proof.ts";
import { applyTrmnlWithClients } from "#activities/delivery/trmnl.ts";
import {
  trmnlRepairClaim,
  verifyTrmnlRepairBackend,
} from "#activities/delivery/trmnl-repair.ts";
import { finishDelivery } from "#activities/delivery/execute.ts";
import { resolveOperatorTemporalApiKey } from "./temporal-operator-credentials.ts";

/** Outage path for an already-authorized fixed repair; never selects Argo source or releases a partial failed result. */
async function main() {
  const flags = parseFlagArguments(
    process.argv.slice(2),
    new Set(["--deployment", "--url"]),
  );
  const id = requiredParsedArgument(flags, "--deployment");
  Bun.env["DELIVERY_API_URL"] = deliveryUrl(
    requiredParsedArgument(flags, "--url"),
  );
  await resolveCredentials([
    "DELIVERY_EXECUTOR_TOKEN",
    "ARGOCD_AUTH_TOKEN",
    "TRMNL_API_KEY",
    "DELIVERY_TRMNL_S3_ACCESS_KEY_ID",
    "DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY",
  ]);
  await resolveOperatorTemporalApiKey();
  Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: requiredEnvironment(Bun.env, "TEMPORAL_ADDRESS"),
    }),
  );
  const signal = AbortSignal.timeout(25 * 60_000);
  const readArgo = createDeliveryArgoReader({
    server: "https://argocd.sjer.red",
    token: requiredEnvironment(Bun.env, "ARGOCD_AUTH_TOKEN"),
    signal,
  });
  const claim = async (detail: Parameters<typeof trmnlRepairClaim>[0]) =>
    await trmnlRepairClaim(
      detail,
      async (sourceId) => await closedPlatformWorkflow(connection, sourceId),
    );
  let claimed = false;
  try {
    const base = `deployments/${encodeURIComponent(id)}`;
    const detail = await deliveryRequest(base, DeploymentDetailSchema);
    if (detail.deployment.kind !== "repair-trmnl")
      throw new Error("Only an explicit TRMNL repair deployment is admitted");
    // Pausing and draining the dispatcher prevents a later Workflow racing this direct invocation.
    const client = new Client({ connection, namespace: "prod" });
    const schedule = await client.schedule
      .getHandle("delivery-dispatch")
      .describe();
    if (!schedule.state.paused || schedule.info.runningActions.length > 0)
      throw new Error(
        "Pause and drain the Delivery dispatcher before direct repair",
      );
    try {
      await closedPlatformWorkflow(connection, id);
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
    await deliveryRequest(
      `${base}/claim`,
      DeploymentDetailSchema,
      await claim(detail),
    );
    claimed = true;
    const evidence = await applyTrmnlWithClients(id, signal, {
      client: createTrmnlPluginClient({
        token: requiredEnvironment(Bun.env, "TRMNL_API_KEY"),
        signal,
      }),
      readArchive: createTrmnlArchiveReader(
        {
          accessKeyId: requiredEnvironment(
            Bun.env,
            "DELIVERY_TRMNL_S3_ACCESS_KEY_ID",
          ),
          secretAccessKey: requiredEnvironment(
            Bun.env,
            "DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY",
          ),
        },
        signal,
      ),
      repairClaim: claim,
      verifyBackend: async (release) =>
        await verifyTrmnlRepairBackend(release, readArgo),
    });
    await finishDelivery(id, { status: "succeeded", evidence });
    console.warn(
      JSON.stringify({
        deploymentId: id,
        status: "succeeded",
        applicationSelection: "unchanged",
      }),
    );
  } catch (error) {
    if (claimed) await finishDelivery(id, { status: "failed", evidence: [] });
    throw error;
  } finally {
    await connection.close();
  }
}
try {
  await main();
} catch {
  console.error(
    "TRMNL repair did not complete. Quarantine remains held; inspect the exact repair and per-plugin receipts before requesting another repair.",
  );
  process.exitCode = 1;
}
