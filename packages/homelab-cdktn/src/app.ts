import { App } from "cdktn";
import type { Construct } from "constructs";
import { OPENTOFU_TARGET_VERSION } from "#src/homelab-stack.ts";
import type { HomelabStack } from "#src/homelab-stack.ts";
import { GithubStack } from "#src/stacks/github.ts";

/**
 * Stacks whose `src/tofu/<stack>/main.tf.json` is synthesized from this app,
 * by their directory under `packages/homelab/src/tofu`. Porting a stack adds
 * it here and to {@link STACKS}; keep both sorted.
 */
export const SYNTHESIZED_STACKS = ["github"] as const;

export type SynthesizedStack = (typeof SYNTHESIZED_STACKS)[number];

const STACKS: Record<SynthesizedStack, new (scope: Construct) => HomelabStack> =
  {
    github: GithubStack,
  };

/**
 * The one cdktn application. Synthesis only writes JSON: OpenTofu, through
 * `scripts/tofu/tofu-stack.ts` and Delivery, stays the execution engine.
 */
export function createApp(outdir: string): App {
  const app = new App({
    outdir,
    context: {
      // Top-level constructs keep their HCL names as resource addresses.
      excludeStackIdFromLogicalIds: "true",
      allowSepCharsInLogicalIds: "true",
      targetVersions: { opentofu: OPENTOFU_TARGET_VERSION },
    },
  });
  for (const stack of SYNTHESIZED_STACKS) new STACKS[stack](app);
  return app;
}
