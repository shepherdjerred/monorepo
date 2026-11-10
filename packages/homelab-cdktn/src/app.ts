import { App } from "cdktn";
import { GithubStack } from "#src/stacks/github.ts";

/** Stacks whose `src/tofu/<stack>/main.tf.json` is synthesized from this app. */
export const SYNTHESIZED_STACKS = ["github"] as const;

export type SynthesizedStack = (typeof SYNTHESIZED_STACKS)[number];

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
      targetVersions: { opentofu: ">=1.11.0" },
    },
  });
  new GithubStack(app);
  return app;
}
