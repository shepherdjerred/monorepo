import type { RuleId } from "./rules.ts";

/**
 * Debt allowlists for the "rendered on both sides" rules (`rules.ts`).
 *
 * Each set is the exceptions to one rule as of the day the platform model was
 * introduced: facts Kubernetes and OpenTofu disagree about today. The test
 * enforces both directions, like `fleet-policy/debt-allowlists.ts`: a
 * disagreement that is not listed fails, and a listed entry that no longer
 * disagrees fails until it is deleted. So these lists only shrink. Do not add
 * an entry to make a new hostname, site, service or credential pass; declare
 * it in `platform-model.json` and render it on both sides.
 */
export const DEBT: Readonly<Record<RuleId, ReadonlySet<string>>> = {
  publicHostnamesWithoutTunnelBinding: new Set(),

  /** Hostnames with a TunnelBinding whose DNS record is not a tunnel CNAME. */
  publicHostnamesWithoutTunnelRecord: new Set([
    // The record is an unproxied CNAME to ipv4.ddns.sjer.red, so the name
    // resolves to the arcade edge directly and the tunnel route is unused.
    "arcade.sjer.red",
    // Retired: the apex is a placeholder AAAA behind an edge redirect. The
    // binding and the static site were kept for the cutover release.
    "clauderon.com",
  ]),

  tunnelBindingsWithoutDefinition: new Set(),

  /** Tunnel CNAMEs that no TunnelBinding routes to a Service. */
  tunnelRecordsWithoutDefinition: new Set([
    // Records in the sjer.red zone named after another zone's hostname.
    "better-skill-capped.com.sjer.red",
    "bluemap.ts-mc.net.sjer.red",
    "bugsink.shepherdjerred.com.sjer.red",
    "discord-plays-pokemon.com.sjer.red",
    "ts-mc.net.sjer.red",
    // No rendered workload serves these names.
    "overseerr.sjer.red",
    "peertube.sjer.red",
  ]),

  staticSitesWithoutCaddySite: new Set(),
  caddySitesWithoutDefinition: new Set(),
  staticSitesWithoutBucket: new Set(),

  /** Buckets whose expiry rule matches no static site. */
  bucketsWithMismatchedExpiry: new Set([
    // Retained assets of the retired Astro portal; no site serves the bucket.
    "ts-mc",
  ]),

  /**
   * Zones whose static sites have immutable prefixes but no static-cache
   * rule, so Cloudflare does not honor the origin's immutable Cache-Control.
   */
  zonesWithMismatchedImmutableCache: new Set([
    // glitter-boys.com: `_astro/`.
    "glitter-boys.com",
    // docs.ts-mc.net and public.ts-mc.net: `_astro/`.
    "ts-mc.net",
  ]),

  tailnetServicesNotRendered: new Set(),
  tailnetDevicesWithoutDefinition: new Set(),
  tailnetTagsMismatched: new Set(),

  /** Tailnet names mentioned on one side that no workload publishes. */
  tailnetNamesWithoutDefinition: new Set([
    // A Turnstile widget domain for the beta forum, which has no release and
    // so renders no ingress.
    "opentofu cloudflare: storm-forum-beta.tailnet-1a49.ts.net",
  ]),

  scopedCredentialsWithoutWriter: new Set(),
  onePasswordWritersWithoutDefinition: new Set(),

  /**
   * Credentials a stack writes that no OnePasswordItem names by title. Their
   * readers are either outside the cluster or reference the item by its
   * opaque ID, which cannot be tied to the writer from source.
   */
  scopedCredentialsWithoutKubernetesReference: new Set([
    "argocd-homelab-audit-token",
    "argocd-workstation-token",
    "backblaze-postgres-wal",
    "backblaze-seaweedfs-backups",
    "backblaze-velero",
    "delivery-argocd-observer-token",
    "delivery-argocd-operator-run-token",
    "delivery-argocd-platform-token",
    "delivery-argocd-token",
  ]),

  bucketConsumersNotRendered: new Set(),
  bucketEnvironmentWithoutDefinition: new Set(),
  bucketConsumersWithoutBucket: new Set(),

  /**
   * Buckets with no declared static site or consumer: their users are not
   * modelled yet (workstations, CI, Delivery, configuration files) or gone.
   */
  bucketsWithoutConsumer: new Set([
    "agent-chat-sessions",
    "apple-sdks",
    "brim-sessions",
    "ci-handoff",
    "delivery-artifacts",
    "homelab-tofu-state",
    "relay-docs",
    "storm-forum-backups",
    "the-storm-capture-fixtures",
    "ts-mc",
  ]),

  onePasswordItemsOutsideVault: new Set(),
  stateBackendsOffTailnetEndpoint: new Set(),
  seaweedfsEndpointsMismatched: new Set(),
};
