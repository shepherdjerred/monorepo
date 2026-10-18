import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import { STACK_MANIFEST } from "./tofu-stack-manifest.ts";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";

const STACKS_REL = "src/tofu";

export type TofuAction =
  "validate" | "plan" | "apply" | "prepare" | "apply-saved";

export function assertStackExecutionContext(
  stack: TofuStack,
  action: TofuAction,
  ci: string | undefined,
): void {
  if (
    action !== "validate" &&
    ci !== undefined &&
    ci !== "" &&
    ci !== "false" &&
    ci !== "0" &&
    STACK_MANIFEST[stack].operatorOnly === true
  ) {
    throw new Error(
      `${stack} is operator-only; CI may validate but not run live operations.`,
    );
  }
}

const TokenChangeSchema = z.object({
  type: z.literal("planned_change"),
  change: z.object({
    resource: z.object({ addr: z.string() }),
    action: z.string(),
  }),
});

/** Provider account-authentication diagnostics can contain MFA challenge tokens. */
export function dockerTokenPlanSummary(stdout: string): string[] {
  try {
    return stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        const parsed = TokenChangeSchema.safeParse(JSON.parse(line));
        return parsed.success
          ? [
              `${parsed.data.change.action}: ${parsed.data.change.resource.addr}`,
            ]
          : [];
      });
  } catch {
    throw new Error("Invalid Docker token operation output; details withheld.");
  }
}

async function runDockerTokenOperation(
  action: "plan" | "apply",
  root: string,
  env: Record<string, string>,
): Promise<void> {
  const child = Bun.spawn(
    [
      "tofu",
      `-chdir=${STACKS_REL}/dockerhub-tokens`,
      action,
      "-input=false",
      "-json",
      ...(action === "plan" ? ["-detailed-exitcode"] : ["-auto-approve"]),
    ],
    { cwd: root, env, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0 && !(action === "plan" && exitCode === 2)) {
    throw new Error(
      `Docker token ${action} failed (exit ${exitCode.toString()}); account-authentication diagnostics withheld.`,
    );
  }
  for (const change of dockerTokenPlanSummary(stdout)) console.log(change);
  console.log(
    action === "plan"
      ? exitCode === 2
        ? "Docker token changes detected."
        : "No Docker token changes."
      : "Docker token apply succeeded; sensitive credentials remain in encrypted state.",
  );
}

export async function runDockerTokenStack(
  action: TofuAction,
  root: string,
  env: Record<string, string>,
): Promise<void> {
  if (action !== "plan" && action !== "apply")
    throw new Error(
      "Docker token stack supports operator plan and apply only.",
    );
  const dataRoot = await mkdtemp(path.join(tmpdir(), "dockerhub-tokens-"));
  const isolatedEnv = { ...env, TF_DATA_DIR: dataRoot };
  try {
    await run(
      [
        "tofu",
        "-chdir=src/tofu/dockerhub-tokens",
        "init",
        "-input=false",
        "-lockfile=readonly",
      ],
      { cwd: root, env: isolatedEnv, inheritEnv: false },
    );
    await runDockerTokenOperation(action, root, isolatedEnv);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}
