import {
  DEPLOY_HELP,
  runDeployCommand,
  validateDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";
import { deliveryClient, deliveryUrl } from "#lib/delivery/client.ts";
import { resolveCredentials } from "#lib/credentials.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { deployMachineCredential } from "#commands/deploy/forum.ts";

export async function handleDeployCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand === undefined ||
    ["--help", "-h"].includes(subcommand) ||
    args.includes("--help")
  ) {
    console.log(DEPLOY_HELP);
    return;
  }
  const { values, positionals } = parseDeployArgs(args);
  validateDeployCommand(subcommand, positionals, values);
  const config = await loadToolkitConfig();
  const url = deliveryUrl(values.url ?? (await config.value("deliveryUrl")));
  const credential = deployMachineCredential(subcommand, positionals);
  if (values.machine) await resolveCredentials([credential]);
  const client = deliveryClient(
    url,
    values.machine ? Bun.env[credential] : undefined,
  );
  const { result, exitCode } = await runDeployCommand(
    client,
    subcommand,
    positionals,
    {
      ...values,
      requestNotice: (id) => {
        console.error(`Delivery request ID: ${id}`);
      },
    },
  );
  console.log(JSON.stringify(result, null, values.json ? undefined : 2));
  process.exitCode = exitCode;
}
