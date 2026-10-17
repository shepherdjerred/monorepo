import { parseArgs } from "node:util";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { deliveryClient } from "@shepherdjerred/toolkit/lib/delivery/client.ts";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { DeliveryRecoverySelectionSchema } from "homelab/scripts/argocd/argocd-delivery-recovery.ts";
import { deliveryRecoverySelection } from "#lib/delivery/recovery.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { file: { type: "string" }, url: { type: "string" } },
});
const [action, deploymentId] = positionals;
if (
  deploymentId === undefined ||
  positionals.length !== 2 ||
  values.file === undefined ||
  (action !== "export" && action !== "settle")
)
  throw new Error(
    "Usage: bun packages/temporal/scripts/recovery/delivery.ts export|settle DEPLOYMENT_ID --file PATH [--url DELIVERY_URL]",
  );
await resolveCredentials(["DELIVERY_API_TOKEN"]);
const client = deliveryClient(
  values.url ?? "https://delivery.tailnet-1a49.ts.net",
  Bun.env["DELIVERY_API_TOKEN"],
);
const frozen = deliveryRecoverySelection(await client.deployment(deploymentId));
if (action === "export") {
  await Bun.write(values.file, `${JSON.stringify(frozen, null, 2)}\n`);
  await Bun.write(
    Bun.stdout,
    "Frozen non-credential recovery selection exported for review.\n",
  );
} else {
  const reviewed = DeliveryRecoverySelectionSchema.parse(
    await Bun.file(values.file).json(),
  );
  if (canonicalJson(reviewed) !== canonicalJson(frozen))
    throw new Error(
      "Reviewed recovery file differs from the currently locked deployment; export and inspect it again",
    );
  await resolveCredentials(["ARGOCD_AUTH_TOKEN"]);
  const token = Bun.env["ARGOCD_AUTH_TOKEN"];
  if (token === undefined)
    throw new Error("Brokered Argo credential is missing");
  const child = Bun.spawn(
    [
      process.execPath,
      new URL("../../../homelab/scripts/argocd/argocd.ts", import.meta.url)
        .pathname,
      "sync-managed",
      frozen.selection.application,
      "--revision",
      frozen.selection.revision,
      "--request-id",
      frozen.requestId,
      "--delivery-selection",
      values.file,
      "--timeout",
      "1200",
    ],
    {
      cwd: new URL("../../../../", import.meta.url).pathname,
      env: {
        PATH: Bun.env["PATH"],
        ARGOCD_TOKEN: token,
        ARGOCD_SERVER_URL: "https://argocd.sjer.red",
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const code = await child.exited;
  if (code !== 0)
    throw new Error(
      "Guarded recovery did not settle successfully; retain ownership and inspect the recorded request",
    );
}
