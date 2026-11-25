import { TerraformOutput } from "cdktn";
import type { TerraformStack, TerraformVariable } from "cdktn";
import { TurnstileWidget } from "#generated/providers/cloudflare/turnstile-widget/index.ts";
import type { Zone } from "#generated/providers/cloudflare/zone/index.ts";
import { cname, srvRecords } from "#src/stacks/cloudflare/records.ts";
import { moved } from "#src/state-migrations.ts";

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
  // join.ts-mc.net is an alias of the landing-pages site in the platform
  // model, so `platform.ts` renders its tunnel CNAME. It was a pair of
  // placeholder addresses behind an edge redirect, and Cloudflare rejects a
  // CNAME while an address record of the same name exists. The CNAME takes
  // over the AAAA record's state, which orders the change in one apply: both
  // placeholders are destroyed before the redirect ruleset they depended on,
  // and the ruleset before the CNAME is created.
  moved(
    stack,
    "cloudflare_dns_record.ts_mc_net_aaaa_join",
    "cloudflare_dns_record.ts_mc_net_cname_join",
  );

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
