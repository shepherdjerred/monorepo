import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  tofuStackPolicy,
  type TofuStack,
} from "@shepherdjerred/ops-model/platform-policy.ts";
import { VAULT_ID } from "#cdk8s/scripts/onepassword-lib.ts";
import {
  DELIVERY_PLATFORM_ITEMS,
  deliveryTofuGrants,
} from "#delivery-platform-grants";

const PLATFORM_ITEMS: Readonly<Record<string, { itemId: string }>> =
  DELIVERY_PLATFORM_ITEMS;

function platformItemId(secret: string): string {
  const item = PLATFORM_ITEMS[secret];
  if (item === undefined) {
    throw new Error(`Unknown Delivery platform secret item: ${secret}`);
  }
  return item.itemId;
}

/**
 * Builds `ENV=op://<vaultId>/<itemId>/<key>` lines for local `plan --service-account`
 * runs on automatic and reviewed-plan stacks using {@link deliveryTofuGrants}.
 */
export function buildServiceAccountEnvFile(
  stack: TofuStack,
  vaultId = VAULT_ID,
): string {
  const { mode } = tofuStackPolicy(stack);
  if (mode !== "automatic" && mode !== "reviewed-plan") {
    throw new Error(
      `--service-account is not available for operator-only stack ${stack} (mode: ${mode}); supply desktop or operator credentials directly.`,
    );
  }
  const lines = deliveryTofuGrants(stack)
    .filter((grant) => grant.env !== "DELIVERY_PLAN_ENCRYPTION_PASSPHRASE")
    .map(
      (grant) =>
        `${grant.env}=op://${vaultId}/${platformItemId(grant.secret)}/${grant.key}`,
    );
  return `${lines.join("\n")}\n`;
}

export function serviceAccountPlanCommand(options: {
  repoRoot: string;
  envFilePath: string;
  stack: TofuStack;
  expectNoChanges: boolean;
  bunExecutable?: string;
  scriptPath: string;
}): string[] {
  return [
    path.join(options.repoRoot, "scripts/onepassword/with-service-account.sh"),
    "op",
    "run",
    "--env-file",
    options.envFilePath,
    "--",
    "env",
    "-u",
    "OP_SERVICE_ACCOUNT_TOKEN",
    options.bunExecutable ?? process.execPath,
    options.scriptPath,
    options.stack,
    "plan",
    ...(options.expectNoChanges ? ["--expect-no-changes"] : []),
  ];
}

export async function runServiceAccountPlan(options: {
  stack: TofuStack;
  root: string;
  scriptPath: string;
  dryRun: boolean;
  expectNoChanges: boolean;
}): Promise<void> {
  const envContent = buildServiceAccountEnvFile(options.stack);
  if (options.dryRun) {
    console.log(
      `DRYRUN: would run tofu plan for ${options.stack} (via service account)`,
    );
    return;
  }
  const repoRoot = path.resolve(options.root, "../..");
  const scratch = await mkdtemp(path.join(tmpdir(), "tofu-sa-env-"));
  try {
    const envFilePath = path.join(scratch, "stack.env");
    await writeFile(envFilePath, envContent, { mode: 0o600 });
    await chmod(envFilePath, 0o600);
    const child = Bun.spawn(
      serviceAccountPlanCommand({
        repoRoot,
        envFilePath,
        stack: options.stack,
        expectNoChanges: options.expectNoChanges,
        scriptPath: options.scriptPath,
      }),
      { cwd: repoRoot, env: Bun.env, stdout: "inherit", stderr: "inherit" },
    );
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      throw new Error(
        `Service-account plan failed for ${options.stack} (exit ${exitCode.toString()})`,
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
