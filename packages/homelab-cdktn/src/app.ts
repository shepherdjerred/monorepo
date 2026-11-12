import { App } from "cdktn";
import type { Construct } from "constructs";
import { OPENTOFU_TARGET_VERSION } from "#src/homelab-stack.ts";
import type { HomelabStack } from "#src/homelab-stack.ts";
import { AnthropicFederationStack } from "#src/stacks/anthropic-federation.ts";
import { AnthropicStack } from "#src/stacks/anthropic.ts";
import { ApplicationSecretsStack } from "#src/stacks/application-secrets.ts";
import { ArgocdStack } from "#src/stacks/argocd.ts";
import { ArrStack } from "#src/stacks/arr.ts";
import { BackblazeStack } from "#src/stacks/backblaze.ts";
import { CloudflareTokensStack } from "#src/stacks/cloudflare-tokens.ts";
import { CloudflareStack } from "#src/stacks/cloudflare/index.ts";
import { DiscordStack } from "#src/stacks/discord.ts";
import { DockerhubStack } from "#src/stacks/dockerhub.ts";
import { DockerhubTokensStack } from "#src/stacks/dockerhub-tokens.ts";
import { GithubStack } from "#src/stacks/github.ts";
import { OpenaiStack } from "#src/stacks/openai.ts";
import { PosthogStack } from "#src/stacks/posthog.ts";
import { SeaweedfsStack } from "#src/stacks/seaweedfs.ts";
import { TailscaleStack } from "#src/stacks/tailscale.ts";

/**
 * Stacks whose `src/tofu/<stack>/main.tf.json` is synthesized from this app,
 * by their directory under `packages/homelab/src/tofu`. Porting a stack adds
 * it here and to {@link STACKS}; keep both sorted.
 */
export const SYNTHESIZED_STACKS = [
  "anthropic",
  "anthropic-federation",
  "application-secrets",
  "argocd",
  "arr",
  "backblaze",
  "cloudflare",
  "cloudflare-tokens",
  "discord",
  "dockerhub",
  "dockerhub-tokens",
  "github",
  "openai",
  "posthog",
  "seaweedfs",
  "tailscale",
] as const;

export type SynthesizedStack = (typeof SYNTHESIZED_STACKS)[number];

const STACKS: Record<SynthesizedStack, new (scope: Construct) => HomelabStack> =
  {
    anthropic: AnthropicStack,
    "anthropic-federation": AnthropicFederationStack,
    "application-secrets": ApplicationSecretsStack,
    argocd: ArgocdStack,
    arr: ArrStack,
    backblaze: BackblazeStack,
    cloudflare: CloudflareStack,
    "cloudflare-tokens": CloudflareTokensStack,
    discord: DiscordStack,
    dockerhub: DockerhubStack,
    "dockerhub-tokens": DockerhubTokensStack,
    github: GithubStack,
    openai: OpenaiStack,
    posthog: PosthogStack,
    seaweedfs: SeaweedfsStack,
    tailscale: TailscaleStack,
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
