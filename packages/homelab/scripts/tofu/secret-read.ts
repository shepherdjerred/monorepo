import type { z } from "zod";
import {
  OpItemSchema,
  OpItemListSchema,
  VAULT_ID,
  type OpItem,
} from "#cdk8s/scripts/onepassword-lib.ts";

const repositoryRoot = new URL("../../../../", import.meta.url).pathname;

/** Capture both streams. Never attach raw stderr, parsed values, or causes to errors. */
export async function capturedRead(
  command: string[],
  operation: string,
  env: Record<string, string | undefined> = Bun.env,
): Promise<string> {
  const isolated = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        key !== "DEBUG" &&
        !key.startsWith("TF_LOG") &&
        !key.startsWith("TF_CLI_ARGS"),
    ),
  );
  try {
    const child = Bun.spawn(command, {
      cwd: repositoryRoot,
      env: isolated,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) throw new Error("failed");
    return stdout;
  } catch {
    throw new Error(`Read failed (${operation}); command output withheld.`);
  }
}

export function parsePrivateJson<Schema extends z.ZodType>(
  value: string,
  schema: Schema,
): z.output<Schema> {
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new Error("Invalid private response; details withheld.");
  }
}

export async function readVaultItem(id: string): Promise<OpItem> {
  return parsePrivateJson(
    await capturedRead(
      [
        `${repositoryRoot}/scripts/onepassword/with-service-account.sh`,
        "op",
        "item",
        "get",
        id,
        "--vault",
        VAULT_ID,
        "--format",
        "json",
      ],
      "1Password item",
    ),
    OpItemSchema,
  );
}

export async function readVault(): Promise<OpItem[]> {
  const items = parsePrivateJson(
    await capturedRead(
      [
        `${repositoryRoot}/scripts/onepassword/with-service-account.sh`,
        "op",
        "item",
        "list",
        "--vault",
        VAULT_ID,
        "--format",
        "json",
      ],
      "1Password list",
    ),
    OpItemListSchema,
  );
  if (items.length === 0)
    throw new Error("Vault inventory is empty; refusing an incomplete audit.");
  const result: OpItem[] = [];
  // Bounded reads keep the account usable while auditing. A failed read aborts
  // the report rather than presenting an incomplete vault as unused.
  for (let index = 0; index < items.length; index += 4) {
    const batch = items.slice(index, index + 4);
    result.push(
      ...(await Promise.all(batch.map(({ id }) => readVaultItem(id)))),
    );
  }
  return result;
}
