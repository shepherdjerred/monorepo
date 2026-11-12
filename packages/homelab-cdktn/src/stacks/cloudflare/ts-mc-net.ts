import { TerraformOutput } from "cdktn";
import type { TerraformStack, TerraformVariable } from "cdktn";
import { TurnstileWidget } from "#generated/providers/cloudflare/turnstile-widget/index.ts";
import type { Zone } from "#generated/providers/cloudflare/zone/index.ts";
import published from "#src/stacks/cloudflare/published-txt-records.json" with { type: "json" };
import {
  cname,
  edgePlaceholder,
  srvRecords,
  txt,
} from "#src/stacks/cloudflare/records.ts";
import { edgeRedirect } from "#src/stacks/cloudflare/zones.ts";

/**
 * Records of ts-mc.net the platform model does not declare; its tunnel
 * hostnames are rendered by `platform.ts`. `storage.ts-mc.net` is absent:
 * that record belongs to `cloudflare_r2_custom_domain.ts_mc`.
 */
export function tsMcNet(stack: TerraformStack, zone: Zone): void {
  cname(stack, "ts_mc_net_cname_minecraft", zone, {
    name: "minecraft",
    content: "ddns.sjer.red",
    proxied: false,
  });
  // join.ts-mc.net 301-redirects to The Storm landing page at the edge. The
  // proxied placeholder records let Cloudflare's edge answer HTTP/HTTPS
  // requests and run the redirect before any origin fetch.
  const redirects = edgeRedirect(stack, "ts_mc_net_redirects", zone.id, {
    rulesetName: "ts-mc.net dynamic redirects",
    ref: "join_to_the_storm",
    description: "Redirect join.ts-mc.net to The Storm landing page",
    expression: '(http.host eq "join.ts-mc.net")',
    preserveQueryString: true,
    targetUrl: { value: "https://public.ts-mc.net/the-storm/" },
  });
  edgePlaceholder(stack, "ts_mc_net_aaaa_join", zone, {
    name: "join",
    type: "AAAA",
    dependsOn: [redirects],
  });
  edgePlaceholder(stack, "ts_mc_net_a_join", zone, {
    name: "join",
    type: "A",
    dependsOn: [redirects],
  });

  const minecraft = {
    priority: 0,
    weight: 5,
    port: 30_000,
    target: "mc.ts-mc.net",
  };
  srvRecords(stack, zone, {
    ts_mc_net_srv_minecraft: { name: "_minecraft._tcp", ...minecraft },
    ts_mc_net_srv_minecraft_join: {
      name: "_minecraft._tcp.join",
      ...minecraft,
    },
  });
}

/**
 * Postal's public ownership challenge and DKIM key for forum@ts-mc.net. The
 * domain already publishes Fastmail SPF, matching Postal's relay provider.
 */
export function stormForumMail(stack: TerraformStack, zone: Zone): void {
  txt(stack, "storm_forum_postal_verification", zone, {
    name: "ts-mc.net",
    content: published.storm_forum_postal_verification,
  });
  txt(stack, "storm_forum_postal_dkim", zone, {
    name: "postal-pucwal._domainkey",
    content: published.storm_forum_postal_dkim,
  });
  cname(stack, "storm_forum_postal_return_path", zone, {
    name: "psrp",
    content: "rp.sjer.red",
    proxied: false,
  });
}

/**
 * The Storm forum's Turnstile widget. Its keys are transferred from protected
 * Tofu state into the dedicated 1Password runtime items through authenticated
 * tooling, never repository files.
 */
export function stormForumTurnstile(
  stack: TerraformStack,
  accountId: TerraformVariable,
): void {
  const widget = new TurnstileWidget(stack, "storm_forum", {
    accountId: accountId.stringValue,
    name: "The Storm forum",
    domains: ["ts-mc.net", "storm-forum-beta.tailnet-1a49.ts.net"],
    mode: "managed",
  });
  new TerraformOutput(stack, "storm_forum_turnstile_site_key", {
    value: widget.sitekey,
    sensitive: true,
  });
  new TerraformOutput(stack, "storm_forum_turnstile_secret_key", {
    value: widget.secret,
    sensitive: true,
  });
}
