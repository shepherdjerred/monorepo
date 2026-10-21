import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  tofuStackPolicy,
  TofuStackSchema,
  type TofuStack,
} from "@shepherdjerred/ops-model/platform-policy.ts";
import {
  buildTofuEnvironment,
  desiredStateVariableValue,
} from "./tofu-stack.ts";
import { STACK_MANIFEST } from "./tofu-stack-manifest.ts";
import { loadPlatformDesiredState } from "#scripts/platform-desired-state.ts";
import { hasLiveCompletionStatus } from "./github-ruleset-ready.ts";

export const DeliveryTofuStateSchema = z.object({
  lineage: z.string().min(1),
  serial: z.number().int().nonnegative(),
});
export type DeliveryTofuState = z.infer<typeof DeliveryTofuStateSchema>;
export type DeliveryTofuChanges = {
  create: number;
  update: number;
  delete: number;
  replace: number;
};
type CommandResult = { stdout: string; exitCode: number };
export type DeliveryTofuContext = {
  stack: TofuStack;
  workspace: string;
  state: () => Promise<DeliveryTofuState>;
  command: (
    args: readonly string[],
    allowedCodes?: readonly number[],
  ) => Promise<CommandResult>;
};
export type DeliveryTofuRunner = (
  command: readonly string[],
  environment: Record<string, string>,
  allowedCodes: readonly number[],
) => Promise<CommandResult>;

/** Syntax diagnostics must not echo provider/state fragments into Activity failures. */
export function privateProviderJson(text: string): unknown {
  return z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({
          code: "custom",
          message: "Provider returned invalid JSON; raw output withheld",
        });
        return z.NEVER;
      }
    })
    .parse(text);
}

/** Provider output can contain secrets. Only typed non-sensitive metadata leaves this boundary. */
const run: DeliveryTofuRunner = async (
  command,
  providerEnvironment,
  allowedCodes,
) => {
  const child = Bun.spawn([...command], {
    env: providerEnvironment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of child.stdout) {
    size += chunk.byteLength;
    if (size > 32 * 1024 * 1024) {
      child.kill("SIGKILL");
      await child.exited;
      throw new Error(
        "Saved-plan provider output exceeded its private byte bound",
      );
    }
    chunks.push(chunk);
  }
  const stdout = Buffer.concat(chunks).toString("utf8");
  const exitCode = await child.exited;
  if (!allowedCodes.includes(exitCode) || stdout.length > 32 * 1024 * 1024)
    throw new Error(
      "Saved-plan OpenTofu command failed; provider output withheld",
    );
  return { stdout, exitCode };
};

export function deliveryTofuChanges(input: unknown): DeliveryTofuChanges {
  const plan = z
    .object({
      resource_changes: z
        .array(
          z.object({
            change: z.object({
              actions: z.array(
                z.enum([
                  "no-op",
                  "read",
                  "create",
                  "update",
                  "delete",
                  "forget",
                ]),
              ),
            }),
          }),
        )
        .default([]),
    })
    .parse(input);
  const counts = { create: 0, update: 0, delete: 0, replace: 0 };
  for (const {
    change: { actions },
  } of plan.resource_changes) {
    if (actions.includes("create") && actions.includes("delete"))
      counts.replace++;
    else if (actions.includes("create")) counts.create++;
    else if (actions.includes("delete") || actions.includes("forget"))
      counts.delete++;
    else if (actions.includes("update")) counts.update++;
  }
  return counts;
}

async function environment(
  stack: TofuStack,
  stackDirectory: string,
  workspace: string,
): Promise<Record<string, string>> {
  const env = buildTofuEnvironment(stack);
  env["TF_DATA_DIR"] = path.join(workspace, "data");
  env["TF_IN_AUTOMATION"] = "true";
  const platform = STACK_MANIFEST[stack].platform;
  if (platform !== undefined) {
    const desired = await loadPlatformDesiredState(stackDirectory, platform);
    for (const [key, value] of Object.entries(desired))
      env[`TF_VAR_${key}`] = desiredStateVariableValue(value);
  }
  if (stack === "github") {
    const token = z.string().min(1).parse(env["TF_VAR_github_token"]);
    if (!(await hasLiveCompletionStatus(token)))
      throw new Error(
        "GitHub ruleset execution deferred until a genuine Woodpecker PR completion is observed",
      );
  }
  return env;
}

/**
 * One saved plan, one stack, and native state locking; callers cannot supply
 * flags or provider values. `options.directory` runs the stack from an
 * extracted archive instead of this checkout's `src/tofu/<stack>` (X8).
 */
export async function withDeliveryTofuStack<T>(
  rawStack: unknown,
  effect: (context: DeliveryTofuContext) => Promise<T>,
  runner: DeliveryTofuRunner = run,
  options: { directory?: string } = {},
): Promise<T> {
  const stack = TofuStackSchema.parse(rawStack);
  if (!["automatic", "reviewed-plan"].includes(tofuStackPolicy(stack).mode))
    throw new Error("This OpenTofu stack has no Delivery execution capability");
  const workspace = await mkdtemp(path.join(tmpdir(), "delivery-tofu-"));
  await chmod(workspace, 0o700);
  try {
    const root = path.resolve(import.meta.dirname, "../..");
    const stackDirectory =
      options.directory ?? path.join(root, "src/tofu", stack);
    const env = await environment(stack, stackDirectory, workspace);
    const command = async (
      args: readonly string[],
      allowedCodes: readonly number[] = [0],
    ) =>
      await runner(
        ["tofu", `-chdir=${stackDirectory}`, ...args],
        env,
        allowedCodes,
      );
    await command(["init", "-input=false", "-lockfile=readonly"]);
    return await effect({
      stack,
      workspace,
      command,
      state: async () => {
        const observed = await command(["state", "pull"]);
        return DeliveryTofuStateSchema.parse(
          privateProviderJson(observed.stdout),
        );
      },
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
