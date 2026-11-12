import type { Construct } from "constructs";
import { Fn, TerraformLocal, TerraformVariable, Token } from "cdktn";
import { Acl } from "#generated/providers/tailscale/acl/index.ts";
import { TailscaleProvider } from "#generated/providers/tailscale/provider/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { TAILNET_POLICY } from "#src/stacks/tailscale-policy.ts";

/**
 * The tailnet policy (ACLs) as code. See `tailscale-policy.ts` for the rules
 * and `packages/homelab/src/tofu/README.md` for how the stack is run.
 *
 * `overwrite_existing_content = true` REPLACES whatever policy exists in the
 * admin console. The account owner (autogroup:admin) keeps full access, so an
 * apply cannot lock the owner out; the policy's `tests` still block any
 * change that drops a path the cluster depends on.
 */
export class TailscaleStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "tailscale", {
      requiredVersion: ">= 1.6.0",
      providerConstraints: { tailscale: "~> 0.17" },
    });

    const tailnet = new TerraformVariable(this, "tailscale_tailnet", {
      description:
        "Tailscale tailnet (organization). '-' resolves to the OAuth client's default tailnet.",
      type: "string",
      default: "-",
    });

    // OAuth client credentials are read from the environment:
    //   TAILSCALE_OAUTH_CLIENT_ID / TAILSCALE_OAUTH_CLIENT_SECRET
    // The OAuth client (admin console, Settings > OAuth clients) has the
    // `acl` scope (write). The stack wrapper injects them.
    new TailscaleProvider(this, "tailscale", {
      tailnet: tailnet.stringValue,
    });

    // The policy's keys are data (tag names, policy fields such as
    // `tagOwners`), so they are passed as-is rather than snake_cased.
    const policy = new TerraformLocal(
      this,
      "policy",
      Token.asAny(TAILNET_POLICY),
    );

    new Acl(this, "homelab", {
      // Required to take over the existing console-managed policy on first
      // apply. Keep true so this stack stays the source of truth thereafter.
      overwriteExistingContent: true,
      acl: Fn.jsonencode(policy.asAnyMap),
    });
  }
}
