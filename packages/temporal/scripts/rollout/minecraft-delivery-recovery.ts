import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { deliveryUrl } from "@shepherdjerred/toolkit/lib/delivery/client.ts";
import {
  parseFlagArguments,
  requiredParsedArgument,
} from "#scripts/cli-arguments.ts";
import {
  recoverMinecraftIntent,
  failMinecraftIntent,
} from "#lib/delivery/minecraft-recovery.ts";
import { minecraftRecoveryControllerOrigin } from "#lib/delivery/minecraft-controller.ts";

/** Explicit Workflow-worker outage path. Reuses the controller journal and API-owned independent proof. */
async function main() {
  const flags = parseFlagArguments(
    process.argv.slice(2),
    new Set(["--intent", "--url", "--controller-url"]),
  );
  const intentId = requiredParsedArgument(flags, "--intent");
  const controllerOrigin = minecraftRecoveryControllerOrigin(
    requiredParsedArgument(flags, "--controller-url"),
  );
  Bun.env["DELIVERY_API_URL"] = deliveryUrl(
    requiredParsedArgument(flags, "--url"),
  );
  await resolveCredentials(["DELIVERY_EXECUTOR_TOKEN"]);
  Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
  try {
    const result = await recoverMinecraftIntent(intentId, {
      controllerOrigin,
    });
    if (result.status !== "succeeded")
      throw new Error(
        "Recovery intent is already terminal without successful settlement",
      );
    console.warn(
      JSON.stringify({
        intentId,
        status: result.status,
        originalDeploymentResult: "unchanged",
      }),
    );
  } catch (error) {
    await failMinecraftIntent(intentId);
    throw error;
  }
}
try {
  await main();
} catch {
  console.error(
    "Independent Minecraft recovery failed. Inspect the intent and private original request journal; do not select or restore a world to clear the lock.",
  );
  process.exitCode = 1;
}
