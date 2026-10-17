import path from "node:path";
import { z } from "zod";
import {
  STACK_MANIFEST,
  STATE_CREDENTIALS,
} from "homelab/scripts/tofu/tofu-stack-manifest.ts";

// Sensitive platform stacks retain their reviewed saved-plan workflow. They
// cannot be reached through the automatic infrastructure apply recipe.
export const TofuApplyInputSchema = z
  .object({ stack: z.enum(["seaweedfs", "tailscale", "github", "cloudflare"]) })
  .strict();

export function tofuApplyCommand(raw: unknown): string[] {
  const { stack } = TofuApplyInputSchema.parse(raw);
  return [
    "bun",
    "--no-install",
    "packages/homelab/scripts/tofu/tofu-stack.ts",
    stack,
    "apply",
  ];
}

export async function run(raw: unknown): Promise<unknown> {
  const input = TofuApplyInputSchema.parse(raw);
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TF_PLUGIN_CACHE_DIR",
    ...STATE_CREDENTIALS.map(({ source }) => source),
    ...STACK_MANIFEST[input.stack].credentials.map(({ source }) => source),
  ];
  const environment = Object.fromEntries(
    allowed.flatMap((key) =>
      Bun.env[key] === undefined ? [] : [[key, Bun.env[key]]],
    ),
  );
  // The wrapper builds its own per-stack allowlisted provider environment;
  // this isolated Job has only the fixed recipe's exact secretKeyRef grants.
  const child = Bun.spawn(tofuApplyCommand(input), {
    cwd: path.resolve(import.meta.dirname, "../../../.."),
    env: { ...environment, CI: "true", TF_IN_AUTOMATION: "true" },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0)
    throw new Error(
      `OpenTofu ${input.stack} apply failed with exit ${code.toString()}; inspect state and the Job receipt before retrying`,
    );
  return { stack: input.stack, outcome: "applied" };
}
