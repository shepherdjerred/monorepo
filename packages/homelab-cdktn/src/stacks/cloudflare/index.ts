import type { Construct } from "constructs";
import { TerraformVariable } from "cdktn";
import type { TerraformStack } from "cdktn";
import { CloudflareProvider } from "#generated/providers/cloudflare/provider/index.ts";
import { Ruleset } from "#generated/providers/cloudflare/ruleset/index.ts";
import { HttpProvider } from "#generated/providers/http/provider/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { domainBaseline } from "#src/stacks/cloudflare/baseline.ts";
import { buckets } from "#src/stacks/cloudflare/buckets.ts";
import { smallerZones } from "#src/stacks/cloudflare/domains.ts";
import {
  modelTunnelCnames,
  staticCaches,
} from "#src/stacks/cloudflare/platform.ts";
import { sjerRed } from "#src/stacks/cloudflare/sjer-red.ts";
import {
  stormForumMail,
  stormForumTurnstile,
  tsMcNet,
} from "#src/stacks/cloudflare/ts-mc-net.ts";
import { zones } from "#src/stacks/cloudflare/zones.ts";
import { adopt } from "#src/state-migrations.ts";

/**
 * DNS zones and records, zone settings, redirect rulesets, R2 buckets and the
 * shared mail and TLS baseline. See `packages/homelab/src/tofu/README.md`.
 *
 * The stack holds no HCL. Application records are created directly in the
 * stack; the per-zone baseline and static-asset caching are the constructs
 * `DomainBaseline` and `StaticCache`, which replaced two local modules and
 * move every resource out of its `module.<name>…` address. Public hostnames
 * and cached prefixes come from the platform model (`platform.ts`).
 */
export class CloudflareStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "cloudflare", {
      requiredVersion: ">= 1.10.0",
      providerConstraints: { cloudflare: "~> 5.27.0", http: "~> 3.5" },
    });

    const accountId = new TerraformVariable(this, "cloudflare_account_id", {
      description: "Cloudflare account ID",
      type: "string",
      sensitive: true,
    });

    // Authenticated via the CLOUDFLARE_API_TOKEN environment variable.
    new CloudflareProvider(this, "cloudflare");
    // Each baseline reads its served MTA-STS policy before publishing it.
    new HttpProvider(this, "http");

    const managed = zones(this, accountId);
    modelTunnelCnames(this, managed);
    for (const cache of staticCaches(this, managed)) cache.moveIntoRoot(this);
    smallerZones(this, managed);
    sjerRed(this, managed["sjer.red"]);
    tsMcNet(this, managed["ts-mc.net"]);
    stormForumMail(this, managed["ts-mc.net"]);
    stormForumTurnstile(this, accountId);
    domainBaseline(this, managed);
    buckets(this, accountId, managed);
    bulkRedirects(this, accountId);
  }
}

/** Redirect every URL in the account's Bulk Redirect list `name`. */
function fromList(name: string) {
  return { fromList: { key: "http.request.full_uri", name } };
}

/**
 * The account Bulk Redirect ruleset. The legacy `sjerred` list includes all
 * subdomains of the two personal .com domains: keep its website redirects
 * while letting their dedicated mail-policy hosts reach the Cloudflare
 * Tunnel. The lists themselves remain external inputs, and both rules keep
 * their stable ids.
 */
function bulkRedirects(
  stack: TerraformStack,
  accountId: TerraformVariable,
): void {
  adopt(
    new Ruleset(stack, "bulk_redirects", {
      accountId: accountId.stringValue,
      name: "default",
      description: "",
      kind: "root",
      phase: "http_request_redirect",
      rules: [
        {
          ref: "fe1c9ab9b8c748b48f5903b135f23507",
          description: "sjerred",
          enabled: true,
          expression:
            '(http.request.full_uri in $sjerred) and not (http.host in {"mta-sts.jerredshepherd.com" "mta-sts.shepherdjerred.com"})',
          action: "redirect",
          actionParameters: fromList("sjerred"),
        },
        {
          ref: "100da224266e402bb21da80d01c5d179",
          description: "resume",
          enabled: false,
          expression: "http.request.full_uri in $resume",
          action: "redirect",
          actionParameters: fromList("resume"),
        },
      ],
    }),
    "accounts/48948ed6cd40d73e34d27f0cc10e595f/ea1ab5d0737441118d227236662533ac",
  );
}
