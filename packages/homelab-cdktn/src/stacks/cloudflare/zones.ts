import type { TerraformStack, TerraformVariable } from "cdktn";
import { z } from "zod";
import { Ruleset } from "#generated/providers/cloudflare/ruleset/index.ts";
import { Zone } from "#generated/providers/cloudflare/zone/index.ts";

const ManagedDomainSchema = z.enum([
  "better-skill-capped.com",
  "clauderon.com",
  "discord-plays-pokemon.com",
  "glitter-boys.com",
  "jerredshepherd.com",
  "scout-for-lol.com",
  "shepherdjerred.com",
  "sjer.red",
  "statically-typed.com",
  "ts-mc.net",
]);

export type ManagedDomain = z.infer<typeof ManagedDomainSchema>;
export type Zones = Readonly<Record<ManagedDomain, Zone>>;

/** Every zone of this stack. */
export const MANAGED_DOMAINS: readonly ManagedDomain[] =
  ManagedDomainSchema.options;

/** `domain` as a zone of this stack; throws for any other name. */
export function managedDomain(domain: string): ManagedDomain {
  return ManagedDomainSchema.parse(domain);
}

/**
 * Resource name of a zone's `cloudflare_zone` (`sjer.red` is `sjer_red`). It
 * is also the prefix of every resource name declared for the zone.
 */
export function zoneResource(domain: ManagedDomain): string {
  return domain.replaceAll(/[.-]/gu, "_");
}

/** The Cloudflare Registrar zone adopted through the normal CI apply. */
const STATICALLY_TYPED_ZONE_ID = "d4036b55fca60ca5f998866309e951d8";

function zone(
  stack: TerraformStack,
  accountId: TerraformVariable,
  domain: ManagedDomain,
): Zone {
  return new Zone(stack, zoneResource(domain), {
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
  const declare = (domain: ManagedDomain) => zone(stack, accountId, domain);
  const managed: Zones = {
    "better-skill-capped.com": declare("better-skill-capped.com"),
    "clauderon.com": declare("clauderon.com"),
    "discord-plays-pokemon.com": declare("discord-plays-pokemon.com"),
    "glitter-boys.com": declare("glitter-boys.com"),
    "jerredshepherd.com": declare("jerredshepherd.com"),
    "scout-for-lol.com": declare("scout-for-lol.com"),
    "shepherdjerred.com": declare("shepherdjerred.com"),
    "sjer.red": declare("sjer.red"),
    "statically-typed.com": declare("statically-typed.com"),
    "ts-mc.net": declare("ts-mc.net"),
  };
  managed["statically-typed.com"].importFrom(STATICALLY_TYPED_ZONE_ID);
  return managed;
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
