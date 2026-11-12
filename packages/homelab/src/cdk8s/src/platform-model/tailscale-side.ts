import { z } from "zod";

/** The part of a read OpenTofu stack that the tailnet policy reader needs. */
type TailscaleStackSource = {
  resources: readonly {
    type: string;
    attributes: ReadonlyMap<string, string>;
  }[];
  locals: Readonly<Record<string, unknown>>;
};

/** The `acl` expression of the synthesized stack. */
const ENCODED_POLICY = "${jsonencode(local.policy)}";

const TailnetPolicySchema = z.looseObject({
  tagOwners: z.record(z.string(), z.array(z.string())),
});

/**
 * The tailscale stack is synthesized: its policy is `local.policy`, which the
 * one `tailscale_acl` resource encodes whole. Anything else fails here, so
 * the tags are never read from a policy other than the one applied.
 */
export function readTailscale(stack: TailscaleStackSource): {
  tailscaleTags: ReadonlySet<string>;
} {
  const policies = stack.resources.filter(
    (resource) => resource.type === "tailscale_acl",
  );
  const [policy] = policies;
  if (policy === undefined || policies.length !== 1)
    throw new Error("tailscale: expected exactly one tailscale_acl");
  if (policy.attributes.get("acl") !== JSON.stringify(ENCODED_POLICY))
    throw new Error(
      "tailscale: tailscale_acl does not encode local.policy; update readTailscale",
    );
  return {
    tailscaleTags: new Set(
      Object.keys(TailnetPolicySchema.parse(stack.locals["policy"]).tagOwners),
    ),
  };
}
