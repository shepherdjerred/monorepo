import type { TerraformStack } from "cdktn";
import {
  cname,
  edgePlaceholder,
  fastmailAutodiscovery,
  tunnelCnames,
} from "#src/stacks/cloudflare/records.ts";
import { edgeRedirect, staticCache } from "#src/stacks/cloudflare/zones.ts";
import type { Zones } from "#src/stacks/cloudflare/zones.ts";
import { moved } from "#src/state-migrations.ts";

/**
 * Application records of the smaller zones. `sjer-red.ts` and `ts-mc-net.ts`
 * hold the two large ones; the shared mail and TLS baseline of every zone is
 * `baseline.ts`.
 */
export function smallerZones(stack: TerraformStack, zones: Zones): void {
  betterSkillCapped(stack, zones);
  clauderon(stack, zones);
  discordPlaysPokemon(stack, zones);
  glitterBoys(stack, zones);
  scoutForLol(stack, zones);
  personalDomains(stack, zones);
  tunnelCnames(stack, zones["statically-typed.com"], {
    statically_typed_com_cname_apex: "statically-typed.com",
  });
}

function betterSkillCapped(stack: TerraformStack, zones: Zones): void {
  const zone = zones["better-skill-capped.com"];
  tunnelCnames(stack, zone, {
    better_skill_capped_com_cname_apex: "better-skill-capped.com",
  });
  staticCache(stack, "better_skill_capped_com_static_cache", zone.id, [
    "/assets/",
  ]);
}

/**
 * The archived site is retired: the zone only redirects to sjer.red. The
 * redirect is active before the records that depend on it replace the working
 * tunnel origin.
 */
function clauderon(stack: TerraformStack, zones: Zones): void {
  const zone = zones["clauderon.com"];
  const redirect = edgeRedirect(stack, "clauderon_com_redirect", zone.id, {
    rulesetName: "clauderon.com to sjer.red",
    ref: "clauderon_to_sjer_red",
    description: "Redirect the retired Clauderon site to sjer.red",
    expression:
      '(http.host eq "clauderon.com" or http.host eq "www.clauderon.com")',
    preserveQueryString: true,
    targetUrl: {
      expression: 'concat("https://sjer.red", http.request.uri.path)',
    },
  });

  // Preserve the existing record's state identity while changing its type.
  // This makes the CNAME-to-AAAA transition an ordered update rather than an
  // unrelated destroy/create pair.
  moved(
    stack,
    "cloudflare_dns_record.clauderon_com_cname_apex",
    "cloudflare_dns_record.clauderon_com_apex",
  );
  const apex = edgePlaceholder(stack, "clauderon_com_apex", zone, {
    name: "clauderon.com",
    type: "AAAA",
    dependsOn: [redirect],
  });
  edgePlaceholder(stack, "clauderon_com_www", zone, {
    name: "www",
    type: "AAAA",
    dependsOn: [redirect],
  });
  // Proxied IPv4 placeholders let IPv4-only clients reach the edge. Cloudflare
  // rejects A/AAAA records while the old apex CNAME still exists.
  edgePlaceholder(stack, "clauderon_com_apex_ipv4", zone, {
    name: "clauderon.com",
    type: "A",
    dependsOn: [apex, redirect],
  });
  edgePlaceholder(stack, "clauderon_com_www_ipv4", zone, {
    name: "www",
    type: "A",
    dependsOn: [redirect],
  });
}

/**
 * The MkDocs site that used to live here was retired when the bot went
 * headless. Every request (apex and any path) 301-redirects to the package
 * README on GitHub.
 */
function discordPlaysPokemon(stack: TerraformStack, zones: Zones): void {
  const zone = zones["discord-plays-pokemon.com"];
  edgePlaceholder(stack, "discord_plays_pokemon_com_apex", zone, {
    name: "discord-plays-pokemon.com",
    type: "AAAA",
  });
  edgeRedirect(stack, "discord_plays_pokemon_com_redirect", zone.id, {
    rulesetName: "discord-plays-pokemon.com to GitHub README",
    ref: "dpp_apex_to_github_readme",
    description:
      "Redirect to the discord-plays-pokemon package README on GitHub",
    expression: '(http.host eq "discord-plays-pokemon.com")',
    preserveQueryString: false,
    targetUrl: {
      value:
        "https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-plays-pokemon",
    },
  });
}

function glitterBoys(stack: TerraformStack, zones: Zones): void {
  tunnelCnames(stack, zones["glitter-boys.com"], {
    // Homelab static site: tunnel, s3-static-sites Caddy, glitter-boys-ppl bucket.
    glitter_boys_com_cname_ppl: "ppl",
    // Main-domain Astro/Starlight site, served by the static-site service.
    glitter_boys_com_cname_apex: "glitter-boys.com",
    // Desktop telemetry ingress, owned by the launcher homelab chart.
    glitter_boys_com_cname_launcher: "launcher",
  });
}

function scoutForLol(stack: TerraformStack, zones: Zones): void {
  const zone = zones["scout-for-lol.com"];
  tunnelCnames(stack, zone, {
    scout_for_lol_com_cname_apex: "scout-for-lol.com",
    scout_for_lol_com_cname_beta: "beta",
    scout_for_lol_com_cname_design: "design",
  });
  staticCache(stack, "scout_for_lol_com_static_cache", zone.id, [
    "/_astro/",
    "/app/assets/",
  ]);
}

function toSjerRed(name: string) {
  return { name, content: "sjer.red", proxied: false };
}

/** The two personal `.com` domains redirect to sjer.red. */
function personalDomains(stack: TerraformStack, zones: Zones): void {
  const jerredshepherd = zones["jerredshepherd.com"];
  cname(
    stack,
    "jerredshepherd_com_cname_apex",
    jerredshepherd,
    toSjerRed("jerredshepherd.com"),
  );
  cname(
    stack,
    "jerredshepherd_com_cname_www",
    jerredshepherd,
    toSjerRed("www"),
  );

  const shepherdjerred = zones["shepherdjerred.com"];
  cname(
    stack,
    "shepherdjerred_com_cname_apex",
    shepherdjerred,
    toSjerRed("shepherdjerred.com"),
  );
  cname(
    stack,
    "shepherdjerred_com_cname_www",
    shepherdjerred,
    toSjerRed("www"),
  );
  fastmailAutodiscovery(stack, shepherdjerred, "shepherdjerred_com");
}
