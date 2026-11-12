import { Token } from "cdktn";
import type { TerraformStack } from "cdktn";
import { DnsRecord } from "#generated/providers/cloudflare/dns-record/index.ts";
import { ZoneSetting } from "#generated/providers/cloudflare/zone-setting/index.ts";
import type { Zone } from "#generated/providers/cloudflare/zone/index.ts";
import published from "#src/stacks/cloudflare/published-txt-records.json" with { type: "json" };
import {
  cname,
  fastmailAutodiscovery,
  mx,
  srvRecords,
  tunnelCnames,
  txt,
} from "#src/stacks/cloudflare/records.ts";
import { edgeRedirect } from "#src/stacks/cloudflare/zones.ts";
import { adopt } from "#src/state-migrations.ts";

/**
 * Tunnel records of sjer.red that no TunnelBinding routes, as resource name
 * to record name. The hostnames a workload serves are declared in the
 * platform model and rendered by `platform.ts`; first-level names only,
 * because Universal SSL covers `*.sjer.red` and nothing deeper.
 *
 * `files.sjer.red` is absent: that record belongs to
 * `cloudflare_r2_custom_domain.sjerred`. `seaweedfs.sjer.red` was removed
 * 2026-06-27: the SeaweedFS S3 API is tailnet-only
 * (`seaweedfs-s3.tailnet-1a49.ts.net`).
 */
const UNROUTED_TUNNEL_HOSTS = {
  // Named after another zone's hostname.
  sjer_red_cname_better_skill_capped_com: "better-skill-capped.com",
  sjer_red_cname_bluemap_ts_mc_net: "bluemap.ts-mc.net",
  sjer_red_cname_bugsink_shepherdjerred_com: "bugsink.shepherdjerred.com",
  sjer_red_cname_discord_plays_pokemon_com: "discord-plays-pokemon.com",
  sjer_red_cname_ts_mc_net: "ts-mc.net",
  // Kept for the Overseerr to Seerr redirect below. The origin is gone; the
  // edge redirect intercepts every request before the tunnel is contacted.
  sjer_red_cname_overseerr: "overseerr",
  sjer_red_cname_peertube: "peertube",
} as const;

export function sjerRed(stack: TerraformStack, zone: Zone): void {
  tunnelCnames(stack, zone, UNROUTED_TUNNEL_HOSTS);

  // PostHog's managed reverse proxy returns the target CNAME; this record is
  // kept unproxied so PostHog can validate and terminate the analytics proxy
  // directly.
  adopt(
    new DnsRecord(stack, "sjer_red_cname_posthog", {
      zoneId: zone.id,
      ttl: 3600,
      name: "j",
      type: "CNAME",
      content: "a9373961b1c868668128.cf-prod-us-proxy.proxyhog.com",
      proxied: false,
    }),
    "879487f81194d63121d0b8dddd16f08f/cf96abd1cc751274baa8e16df54e2b45",
  );

  cname(stack, "sjer_red_cname_arcade", zone, {
    name: "arcade",
    content: "ipv4.ddns.sjer.red",
    proxied: false,
  });

  // Overseerr was migrated to Seerr (users and request history imported into
  // the Seerr DB, 2026-07-03). overseerr.sjer.red stays a proxied CNAME so
  // the hostname still resolves through Cloudflare; this ruleset runs at the
  // edge before any origin fetch and 301s every request to seerr.sjer.red
  // (path and query preserved), so the now-routeless tunnel target is never
  // contacted.
  edgeRedirect(stack, "sjer_red_redirects", zone.id, {
    rulesetName: "sjer.red dynamic redirects",
    ref: "overseerr_to_seerr",
    description:
      "Redirect overseerr.sjer.red to seerr.sjer.red (Overseerr retired)",
    expression: '(http.host eq "overseerr.sjer.red")',
    preserveQueryString: true,
    targetUrl: {
      expression: 'concat("https://seerr.sjer.red", http.request.uri.path)',
    },
  });

  mail(stack, zone);
  services(stack, zone);
  settings(stack, zone);
}

/** Postal bounce routing and sender authentication on `rp.sjer.red`. */
function mail(stack: TerraformStack, zone: Zone): void {
  mx(stack, "sjer_red_mx_rp1", zone, {
    name: "rp",
    content: "in1-smtp.messagingengine.com",
    priority: 10,
  });
  mx(stack, "sjer_red_mx_rp2", zone, {
    name: "rp",
    content: "in2-smtp.messagingengine.com",
    priority: 20,
  });
  txt(stack, "sjer_red_spf_rp", zone, {
    name: "rp",
    content: "v=spf1 include:spf.messagingengine.com -all",
  });

  // Postal DKIM keys.
  txt(stack, "sjer_red_dkim_postal_aoolxx", zone, {
    name: "postal-aoolxx._domainkey",
    content: published.sjer_red_dkim_postal_aoolxx,
  });
  txt(stack, "sjer_red_dkim_postal_isna7c", zone, {
    name: "postal-isna7c._domainkey",
    content: published.sjer_red_dkim_postal_isna7c,
  });

  // Legacy ACME challenges (Tailscale certs).
  txt(stack, "sjer_red_acme_influxdb", zone, {
    name: "_acme-challenge.influxdb.ts.zeus",
    content: published.sjer_red_acme_influxdb,
  });
  txt(stack, "sjer_red_acme_syncthing", zone, {
    name: "_acme-challenge.syncthing.ts.zeus",
    content: published.sjer_red_acme_syncthing,
  });
}

function services(stack: TerraformStack, zone: Zone): void {
  fastmailAutodiscovery(stack, zone, "sjer_red");
  srvRecords(stack, zone, {
    sjer_red_srv_minecraft: {
      name: "_minecraft._tcp",
      priority: 0,
      weight: 5,
      port: 30_000,
      target: "mc.sjer.red",
    },
    sjer_red_srv_minecraft_shuxin: {
      name: "_minecraft._tcp.shuxin",
      priority: 0,
      weight: 5,
      port: 30_000,
      target: "shuxin.sjer.red",
    },
  });
}

function settings(stack: TerraformStack, zone: Zone): void {
  // WebSockets are on by default for every Cloudflare plan, but
  // arcade.sjer.red's driver feed depends on them: it serves H.264 over a raw
  // WebSocket with no polling fallback, so a dashboard toggle here would
  // silently break in-browser video while the rest of the site kept working.
  // Pinned so the dependency is explicit rather than inherited.
  new ZoneSetting(stack, "sjer_red_websockets", {
    zoneId: zone.id,
    settingId: "websockets",
    value: Token.asAny("on"),
  });

  // Delivery verifies public static responses against the immutable archive.
  // Cloudflare Fonts rewrites Google Fonts links into inline CSS, changing
  // bytes.
  new ZoneSetting(stack, "sjer_red_fonts", {
    zoneId: zone.id,
    settingId: "fonts",
    value: Token.asAny("off"),
  });
}
