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
import { redactSecrets } from "#shared/redact.ts";
import { openOperatorRecovery } from "./temporal-operator-credentials.ts";

const SECRET_ENV_NAME = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/iu;

function errorChain(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message.length > 0 ? current.message : current.name);
      current = current.cause;
    } else {
      parts.push(
        typeof current === "string" ? current : JSON.stringify(current),
      );
      break;
    }
  }
  return parts.filter((part) => part.length > 0).join(": ");
}

export function formatPlatformRecoveryFailure(
  error: unknown,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  const tokens = Object.entries(environment).flatMap(([name, value]) =>
    SECRET_ENV_NAME.test(name) ? [value] : [],
  );
  const detail = redactSecrets(errorChain(error), tokens).trim();
  const suffix = detail.length > 0 ? ` (${detail})` : "";
  return `Independent platform recovery failed${suffix}; original result and quarantine remain unchanged. Inspect the exact intent and native receipts before retrying.`;
}

/** The same fixed native recipes work during a Delivery worker outage; no arbitrary source/stack/command input exists. */
async function main() {
  const flags = parseFlagArguments(
    process.argv.slice(2),
    new Set(["--intent", "--url", "--context", "--action"]),
  );
  const id = requiredParsedArgument(flags, "--intent");
  const action = RecoveryActionSchema.parse(
    requiredParsedArgument(flags, "--action"),
  );
  const context = z
    .literal("admin@torvalds")
    .parse(requiredParsedArgument(flags, "--context"));
  Bun.env["DELIVERY_API_URL"] = deliveryUrl(
    requiredParsedArgument(flags, "--url"),
  );
  await resolveCredentials(["DELIVERY_EXECUTOR_TOKEN"]);
  const { kubernetes, connection } = await openOperatorRecovery(context);
  try {
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
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(formatPlatformRecoveryFailure(error));
    process.exitCode = 1;
  }
}
