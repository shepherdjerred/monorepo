import { z } from "zod";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { deliveryUrl } from "@shepherdjerred/toolkit/lib/delivery/client.ts";
import {
  parseFlagArguments,
  requiredParsedArgument,
} from "#scripts/cli-arguments.ts";
import { runDeliveryJob } from "#lib/delivery/job.ts";
import { RecoveryActionSchema } from "#lib/delivery/platform/recovery/request.ts";
import { executePlatformRecoveryAction } from "#lib/delivery/platform/recovery/execute.ts";
import {
  closedPlatformWorkflow,
  provePlatformNativeJobs,
} from "#lib/delivery/platform/recovery/native-proof.ts";
import { recoveryJobReader } from "#lib/delivery/workers/worker-recovery-jobs.ts";
import { openOperatorRecovery } from "./temporal-operator-credentials.ts";
import { recoverStoppedRoot } from "./stopped-root-recovery.ts";

/** The same fixed native recipes work during a Delivery worker outage; no arbitrary source/stack/command input exists. */
async function main() {
  const flags = parseFlagArguments(
    process.argv.slice(2),
    new Set(["--intent", "--url", "--context", "--action"]),
  );
  const id = requiredParsedArgument(flags, "--intent");
  const selectedAction = requiredParsedArgument(flags, "--action");
  const action =
    selectedAction === "inspect-stopped-root"
      ? selectedAction
      : RecoveryActionSchema.parse(selectedAction);
  const context = z
    .literal("admin@torvalds")
    .parse(requiredParsedArgument(flags, "--context"));
  Bun.env["DELIVERY_API_URL"] = deliveryUrl(
    requiredParsedArgument(flags, "--url"),
  );
  await resolveCredentials([
    "DELIVERY_EXECUTOR_TOKEN",
    ...(action === "inspect-stopped-root" ? ["ARGOCD_AUTH_TOKEN"] : []),
  ]);
  const { kubernetes, connection } = await openOperatorRecovery(context);
  try {
    if (action === "inspect-stopped-root") {
      console.warn(JSON.stringify(await recoverStoppedRoot(id, connection)));
      return;
    }
    const result = await executePlatformRecoveryAction(id, action, {
      runJob: async (request, onReceipt, continuation) =>
        await runDeliveryJob(request, onReceipt, continuation, {
          kubernetes,
          cancellationSignal: AbortSignal.timeout(135 * 60_000),
          heartbeat: () => {
            /* Foreground native Job polling is the operator progress mechanism. */
          },
        }),
      closedWorkflow: async (deploymentId) =>
        await closedPlatformWorkflow(connection, deploymentId),
      nativeJobs: async (requested) =>
        await provePlatformNativeJobs(
          requested,
          recoveryJobReader(kubernetes, "delivery-platform-jobs"),
        ),
    });
    console.warn(JSON.stringify({ intentId: id, ...result }));
  } finally {
    await connection.close();
  }
}
try {
  await main();
} catch {
  console.error(
    "Independent platform recovery failed; original result and quarantine remain unchanged. Inspect the exact intent and native receipts before retrying.",
  );
  process.exitCode = 1;
}
