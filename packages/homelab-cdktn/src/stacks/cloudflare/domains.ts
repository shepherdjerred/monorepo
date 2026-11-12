import type { TerraformStack } from "cdktn";
import {
  cname,
  edgePlaceholder,
  fastmailAutodiscovery,
} from "#src/stacks/cloudflare/records.ts";
import { edgeRedirect } from "#src/stacks/cloudflare/zones.ts";
import type { Zones } from "#src/stacks/cloudflare/zones.ts";
import { moved } from "#src/state-migrations.ts";

/**
 * Records of the smaller zones that the platform model does not declare:
 * redirects, placeholders and the personal domains. `sjer-red.ts` and
 * `ts-mc-net.ts` hold the two large zones, `platform.ts` every tunnel
 * hostname and cache rule, and `baseline.ts` the shared mail and TLS
 * baseline.
 */
export function smallerZones(stack: TerraformStack, zones: Zones): void {
  clauderon(stack, zones);
  discordPlaysPokemon(stack, zones);
  personalDomains(stack, zones);
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
