import { z } from "zod";
import rawPolicy from "@shepherdjerred/ops-model/platform-policy.json" with { type: "json" };

export const TofuStackSchema = z.enum([
  "application-secrets",
  "anthropic",
  "anthropic-federation",
  "argocd",
  "arr",
  "asuswrt",
  "backblaze",
  "cloudflare",
  "cloudflare-tokens",
  "discord",
  "dockerhub",
  "dockerhub-tokens",
  "github",
  "google",
  "openai",
  "posthog",
  "seaweedfs",
  "tailscale",
]);
export type TofuStack = z.infer<typeof TofuStackSchema>;
export const PlatformPrerequisiteSchema = z.enum([
  "root",
  "tofu:seaweedfs",
  "tofu:tailscale",
  "tofu:arr",
]);
const TofuStackPolicySchema = z.strictObject({
  mode: z.enum([
    "automatic",
    "reviewed-plan",
    "operator-only",
    "validate-only",
  ]),
  prerequisites: z.array(PlatformPrerequisiteSchema),
});
export const PLATFORM_POLICY = z
  .strictObject({
    schemaVersion: z.literal(1),
    rootPrerequisites: z.array(PlatformPrerequisiteSchema),
    stacks: z.record(TofuStackSchema, TofuStackPolicySchema),
  })
  .parse(rawPolicy);
export const TOFU_STACK_POLICIES = PLATFORM_POLICY.stacks;
export function tofuStackPolicy(
  stack: TofuStack,
): z.infer<typeof TofuStackPolicySchema> {
  return TOFU_STACK_POLICIES[TofuStackSchema.parse(stack)];
}
