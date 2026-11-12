import { TerraformHclModule } from "cdktn";
import type { TerraformStack, TerraformVariable } from "cdktn";
import { Ruleset } from "#generated/providers/cloudflare/ruleset/index.ts";
import { Zone } from "#generated/providers/cloudflare/zone/index.ts";

/** Resource name of each managed zone's `cloudflare_zone`, by domain. */
const ZONE_RESOURCES = {
  "better-skill-capped.com": "better_skill_capped_com",
  "clauderon.com": "clauderon_com",
  "discord-plays-pokemon.com": "discord_plays_pokemon_com",
  "glitter-boys.com": "glitter_boys_com",
  "jerredshepherd.com": "jerredshepherd_com",
  "scout-for-lol.com": "scout_for_lol_com",
  "shepherdjerred.com": "shepherdjerred_com",
  "sjer.red": "sjer_red",
  "statically-typed.com": "statically_typed_com",
  "ts-mc.net": "ts_mc_net",
} as const;

export type ManagedDomain = keyof typeof ZONE_RESOURCES;
export type Zones = Readonly<Record<ManagedDomain, Zone>>;

/** The Cloudflare Registrar zone adopted through the normal CI apply. */
const STATICALLY_TYPED_ZONE_ID = "d4036b55fca60ca5f998866309e951d8";

function zone(
  stack: TerraformStack,
  accountId: TerraformVariable,
  domain: ManagedDomain,
): Zone {
  return new Zone(stack, ZONE_RESOURCES[domain], {
    account: { id: accountId.stringValue },
    name: domain,
    ...(domain === "statically-typed.com"
      ? { type: "full", paused: false }
      : {}),
  });
}

/** Every managed zone. This stack never creates or replaces a zone. */
export function zones(
  stack: TerraformStack,
  accountId: TerraformVariable,
): Zones {
  const managed: Zones = {
    "better-skill-capped.com": zone(
      stack,
      accountId,
      "better-skill-capped.com",
    ),
    "clauderon.com": zone(stack, accountId, "clauderon.com"),
    "discord-plays-pokemon.com": zone(
      stack,
      accountId,
      "discord-plays-pokemon.com",
    ),
    "glitter-boys.com": zone(stack, accountId, "glitter-boys.com"),
    "jerredshepherd.com": zone(stack, accountId, "jerredshepherd.com"),
    "scout-for-lol.com": zone(stack, accountId, "scout-for-lol.com"),
    "shepherdjerred.com": zone(stack, accountId, "shepherdjerred.com"),
    "sjer.red": zone(stack, accountId, "sjer.red"),
    "statically-typed.com": zone(stack, accountId, "statically-typed.com"),
    "ts-mc.net": zone(stack, accountId, "ts-mc.net"),
  };
  managed["statically-typed.com"].importFrom(STATICALLY_TYPED_ZONE_ID);
  return managed;
}

/**
 * Static-asset caching for a zone: respect the immutable Cache-Control the
 * deploy sets on content-hashed assets under `assetPrefixes`, plus Smart
 * Tiered Cache (origin shielding). The module stays HCL
 * (`modules/static-cache`), so its resources keep their
 * `module.<id>.…` addresses.
 */
export function staticCache(
  stack: TerraformStack,
  id: string,
  zoneId: string,
  assetPrefixes: string[],
): TerraformHclModule {
  return new TerraformHclModule(stack, id, {
    source: "./modules/static-cache",
    // The module directory is committed next to main.tf.json; cdktn would
    // otherwise copy it into the synthesis as an asset and rewrite `source`.
    skipAssetCreationFromLocalModules: true,
    variables: { zone_id: zoneId, asset_prefixes: assetPrefixes },
  });
}

/**
 * A zone's single dynamic-redirect rule: 301 every request matching
 * `expression` at the edge, before any origin fetch.
 */
export function edgeRedirect(
  stack: TerraformStack,
  id: string,
  zoneId: string,
  rule: {
    rulesetName: string;
    ref: string;
    description: string;
    expression: string;
    preserveQueryString: boolean;
    /** A fixed URL (`value`) or a URL computed per request (`expression`). */
    targetUrl: { value: string } | { expression: string };
  },
): Ruleset {
  return new Ruleset(stack, id, {
    zoneId,
    name: rule.rulesetName,
    kind: "zone",
    phase: "http_request_dynamic_redirect",
    rules: [
      {
        ref: rule.ref,
        description: rule.description,
        expression: rule.expression,
        action: "redirect",
        actionParameters: {
          fromValue: {
            statusCode: 301,
            preserveQueryString: rule.preserveQueryString,
            targetUrl: rule.targetUrl,
          },
        },
      },
    ],
  });
}
