/**
 * The platform model: cross-tool facts declared once.
 *
 * Kubernetes (cdk8s) and OpenTofu (HCL stacks and the CDK Terrain app) each
 * render half of the same fact: a public hostname is a TunnelBinding and a
 * Cloudflare CNAME, a static site is a Caddy host and a SeaweedFS bucket. This
 * module is the single definition both synthesizers will consume.
 *
 * `platform-model.json` holds the language-neutral data. Facts another
 * registry already owns are imported here, never copied: mail-policy hosts
 * come from `domain-registry.json`, and workload credentials from the
 * `google` and `anthropic-federation` desired state.
 *
 * cdk8s renders from the model through the lookups at the end of this module;
 * an id the model does not declare throws at synthesis. The `cloudflare`
 * stack renders its tunnel CNAMEs and static-asset cache rules from the same
 * accessors (`packages/homelab-cdktn/src/stacks/cloudflare/platform.ts`), the
 * `seaweedfs` stack its buckets and their expiring prefixes. A stack can
 * still write a value the model
 * does not declare, so
 * `cdk8s/src/platform-model/rendered-on-both-sides.test.ts` holds every
 * definition against both renderings.
 */
import { z } from "zod";
import { domainRegistry, mailPolicyHosts } from "./domain-registry.ts";
import modelJson from "./platform-model.json" with { type: "json" };
import anthropicFederationDesiredState from "./tofu/anthropic-federation/desired-state.json" with { type: "json" };
import googleDesiredState from "./tofu/google/desired-state.json" with { type: "json" };

const dnsName = z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/);
const dnsLabel = z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
const tailscaleTag = z.string().regex(/^tag:[a-z0-9-]+$/);
const bucketName = z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
const onePasswordItemTitle = z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/);

/** A hostname served through the Cloudflare Tunnel by an in-cluster Service. */
export const PublicHostnameSchema = z.strictObject({
  hostname: dnsName,
  namespace: dnsLabel,
  service: dnsLabel,
});
export type PublicHostname = z.infer<typeof PublicHostnameSchema>;

/**
 * A site served from a SeaweedFS bucket by the shared static-site origin.
 * `immutablePrefixes` are the bucket key prefixes that hold content-hashed
 * assets: the bucket expires old ones, and the hostname's Cloudflare zone
 * respects their origin Cache-Control.
 */
export const StaticSiteSchema = z.strictObject({
  hostname: dnsName,
  bucket: bucketName,
  immutablePrefixes: z.array(z.string().regex(/^[^/].*\/$/)),
});
export type StaticSite = z.infer<typeof StaticSiteSchema>;

/**
 * A tailnet device a cluster workload publishes as `<host>.<tailnet domain>`.
 *
 * - `ingress`: an operator proxy for an Ingress (`TailscaleIngress`).
 * - `loadBalancer`: an operator proxy for a `loadBalancerClass: tailscale`
 *   Service.
 * - `tsnet`: the workload joins the tailnet itself and advertises its tags.
 *
 * Without `tags`, the device carries the operator's default proxy tags.
 */
export const TailnetServiceSchema = z.strictObject({
  host: dnsLabel,
  namespace: dnsLabel,
  exposure: z.enum(["ingress", "loadBalancer", "tsnet"]),
  tags: z.array(tailscaleTag).min(1).optional(),
});
export type TailnetService = z.infer<typeof TailnetServiceSchema>;

/**
 * A credential an OpenTofu stack mints and writes to a 1Password item, which
 * workloads read by item title. `namespace` is set when the credential is
 * issued for one namespace.
 */
export const ScopedCredentialSchema = z.strictObject({
  itemTitle: onePasswordItemTitle,
  writer: z.strictObject({
    stack: dnsLabel,
    /** `<type>.<name>`, without any `for_each` key. */
    resource: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/),
  }),
  namespace: dnsLabel.optional(),
});
export type ScopedCredential = z.infer<typeof ScopedCredentialSchema>;

/**
 * A namespace whose workloads use a SeaweedFS bucket, named through one
 * environment variable. Static-site buckets are consumed by the static-site
 * origin and are declared as `StaticSite` instead.
 */
export const BucketConsumerSchema = z.strictObject({
  bucket: bucketName,
  namespace: dnsLabel,
  env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
});
export type BucketConsumer = z.infer<typeof BucketConsumerSchema>;

function duplicates<ITEM>(
  items: ITEM[],
  key: (item: ITEM) => string,
): string[] {
  const keys = items.map((item) => key(item));
  return [...new Set(keys.filter((item, index) => keys.indexOf(item) < index))];
}

/** A Zod refinement: no two items share a key. */
function unique<ITEM>(
  key: (item: ITEM) => string,
  label: string,
): (items: ITEM[], context: z.RefinementCtx) => void {
  return (items, context) => {
    const repeated = duplicates(items, key);
    if (repeated.length > 0)
      context.addIssue({
        code: "custom",
        message: `Duplicate ${label}: ${repeated.join(", ")}`,
      });
  };
}

function assertUnique<ITEM>(
  items: ITEM[],
  key: (item: ITEM) => string,
  label: string,
): ITEM[] {
  const repeated = duplicates(items, key);
  if (repeated.length > 0)
    throw new Error(`Duplicate ${label}: ${repeated.join(", ")}`);
  return items;
}

export const PlatformModelSchema = z
  .strictObject({
    cloudflareTunnel: z.strictObject({
      /** The cluster-scoped tunnel resource TunnelBindings reference. */
      name: dnsLabel,
      kind: z.literal("ClusterTunnel"),
      /** The Cloudflare tunnel UUID; DNS records point at `<id>.cfargotunnel.com`. */
      id: z.uuid(),
    }),
    tailnet: z.strictObject({
      domain: dnsName,
      /** Tags the Tailscale operator gives a proxy that declares none. */
      defaultProxyTags: z.array(tailscaleTag).min(1),
      /** Every tag the tailnet policy assigns an owner. */
      tags: z.array(tailscaleTag).min(1),
    }),
    seaweedfs: z.strictObject({
      namespace: dnsLabel,
      /** S3 endpoint for workloads in the cluster. */
      s3InClusterEndpoint: z.url(),
      /** The `TailnetService` host serving S3 to everything outside it. */
      s3TailnetHost: dnsLabel,
    }),
    onePassword: z.strictObject({
      /** The vault the cluster's 1Password operator syncs. */
      vaultId: z.string().regex(/^[a-z0-9]{26}$/),
      vaultName: z.string().min(1),
    }),
    /** The Service every static site's hostname is routed to. */
    staticSiteOrigin: z.strictObject({
      namespace: dnsLabel,
      service: dnsLabel,
    }),
    publicHostnames: z
      .array(PublicHostnameSchema)
      .superRefine(unique((entry) => entry.hostname, "public hostname")),
    staticSites: z
      .array(StaticSiteSchema)
      .superRefine(unique((site) => site.hostname, "static site hostname"))
      .superRefine(unique((site) => site.bucket, "static site bucket")),
    tailnetServices: z
      .array(TailnetServiceSchema)
      .superRefine(unique((service) => service.host, "tailnet host")),
    scopedCredentials: z
      .array(ScopedCredentialSchema)
      .superRefine(
        unique((credential) => credential.itemTitle, "1Password item"),
      ),
    bucketConsumers: z
      .array(BucketConsumerSchema)
      .superRefine(
        unique(
          (consumer) =>
            `${consumer.bucket}/${consumer.namespace}/${consumer.env}`,
          "bucket consumer",
        ),
      ),
  })
  .superRefine((model, context) => {
    const tags = new Set(model.tailnet.tags);
    const undeclared = [
      ...model.tailnet.defaultProxyTags,
      ...model.tailnetServices.flatMap((service) => service.tags ?? []),
    ].filter((tag) => !tags.has(tag));
    if (undeclared.length > 0)
      context.addIssue({
        code: "custom",
        message: `Tags missing from tailnet.tags: ${[...new Set(undeclared)].join(", ")}`,
      });
    if (
      !model.tailnetServices.some(
        (service) => service.host === model.seaweedfs.s3TailnetHost,
      )
    )
      context.addIssue({
        code: "custom",
        message: `seaweedfs.s3TailnetHost ${model.seaweedfs.s3TailnetHost} is not a tailnet service`,
      });
  });
export type PlatformModel = z.infer<typeof PlatformModelSchema>;

const WorkloadCredentialsSchema = z.record(
  z.string(),
  z.looseObject({
    onepassword_item_title: onePasswordItemTitle,
    namespace: dnsLabel.optional(),
  }),
);
const GoogleDesiredStateSchema = z.looseObject({
  google_workloads: WorkloadCredentialsSchema,
});
const AnthropicFederationDesiredStateSchema = z.looseObject({
  anthropic_federation_workloads: WorkloadCredentialsSchema,
});

export const platformModel = PlatformModelSchema.parse(modelJson);

/** The managed Cloudflare zone a hostname belongs to: its longest matching domain. */
export function zoneOf(hostname: string): string {
  const zone = Object.keys(domainRegistry.domains)
    .filter((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    .toSorted((left, right) => right.length - left.length)[0];
  if (zone === undefined)
    throw new Error(`${hostname} is in no managed Cloudflare zone`);
  return zone;
}

/** What a tunnel hostname's DNS record points at. */
export function tunnelCnameTarget(
  model: PlatformModel = platformModel,
): string {
  return `${model.cloudflareTunnel.id}.cfargotunnel.com`;
}

export function tailnetFqdn(
  host: string,
  model: PlatformModel = platformModel,
): string {
  return `${host}.${model.tailnet.domain}`;
}

/** SeaweedFS S3 for everything outside the cluster, OpenTofu state included. */
export function seaweedfsTailnetS3Endpoint(
  model: PlatformModel = platformModel,
): string {
  return `https://${tailnetFqdn(model.seaweedfs.s3TailnetHost, model)}`;
}

/**
 * Every hostname routed through the tunnel: the declared ones, each static
 * site, and the MTA-STS policy host of each registered domain. The last two
 * are served by the static-site origin.
 */
export function publicHostnames(
  model: PlatformModel = platformModel,
): PublicHostname[] {
  const hostnames: PublicHostname[] = [
    ...model.publicHostnames,
    ...[
      ...model.staticSites.map((site) => site.hostname),
      ...mailPolicyHosts.map((host) => host.hostname),
    ].map((hostname) => ({ hostname, ...model.staticSiteOrigin })),
  ];
  return assertUnique(hostnames, (entry) => entry.hostname, "public hostname");
}

/**
 * The URL path prefixes each Cloudflare zone caches as immutable: the
 * immutable bucket prefixes of every static site in the zone.
 */
export function immutablePathPrefixesByZone(
  model: PlatformModel = platformModel,
): Map<string, string[]> {
  const byZone = new Map<string, Set<string>>();
  for (const site of model.staticSites) {
    if (site.immutablePrefixes.length === 0) continue;
    const zone = zoneOf(site.hostname);
    const prefixes = byZone.get(zone) ?? new Set<string>();
    for (const prefix of site.immutablePrefixes) prefixes.add(`/${prefix}`);
    byZone.set(zone, prefixes);
  }
  return new Map(
    [...byZone].map(([zone, prefixes]) => [zone, [...prefixes].toSorted()]),
  );
}

/**
 * The bucket key prefixes each static-site bucket expires old objects under:
 * the immutable prefixes of the site it serves. A site without any is absent.
 */
export function immutablePrefixesByBucket(
  model: PlatformModel = platformModel,
): Map<string, string[]> {
  return new Map(
    model.staticSites
      .filter((site) => site.immutablePrefixes.length > 0)
      .map((site) => [site.bucket, site.immutablePrefixes]),
  );
}

/** Every SeaweedFS bucket the model declares: a static site's or a consumer's. */
export function declaredBuckets(
  model: PlatformModel = platformModel,
): string[] {
  return [
    ...new Set([
      ...model.staticSites.map((site) => site.bucket),
      ...model.bucketConsumers.map((consumer) => consumer.bucket),
    ]),
  ].toSorted();
}

/**
 * Every scoped credential: the declared ones plus one per workload in the
 * `google` and `anthropic-federation` desired state, whose item titles those
 * stacks already own.
 */
export function scopedCredentials(
  model: PlatformModel = platformModel,
): ScopedCredential[] {
  const fromDesiredState = (
    workloads: z.infer<typeof WorkloadCredentialsSchema>,
    writer: ScopedCredential["writer"],
  ): ScopedCredential[] =>
    Object.values(workloads).map((workload) => ({
      itemTitle: workload.onepassword_item_title,
      writer,
      ...(workload.namespace === undefined
        ? {}
        : { namespace: workload.namespace }),
    }));
  const credentials: ScopedCredential[] = [
    ...model.scopedCredentials,
    ...fromDesiredState(
      GoogleDesiredStateSchema.parse(googleDesiredState).google_workloads,
      { stack: "google", resource: "onepassword_item.gemini" },
    ),
    ...fromDesiredState(
      AnthropicFederationDesiredStateSchema.parse(
        anthropicFederationDesiredState,
      ).anthropic_federation_workloads,
      {
        stack: "anthropic-federation",
        resource: "onepassword_item.workload_identity",
      },
    ),
  ];
  return assertUnique(
    credentials,
    (credential) => credential.itemTitle,
    "1Password item",
  );
}

/** The model with everything it derives from other registries resolved. */
export type PlatformDefinitions = {
  model: PlatformModel;
  publicHostnames: readonly PublicHostname[];
  scopedCredentials: readonly ScopedCredential[];
  immutablePathPrefixesByZone: ReadonlyMap<string, readonly string[]>;
};

export function platformDefinitions(
  model: PlatformModel = platformModel,
): PlatformDefinitions {
  return {
    model,
    publicHostnames: publicHostnames(model),
    scopedCredentials: scopedCredentials(model),
    immutablePathPrefixesByZone: immutablePathPrefixesByZone(model),
  };
}

/** The one entry that matches. None, or several, is an undeclared id. */
function declared<ITEM>(
  items: readonly ITEM[],
  matches: (item: ITEM) => boolean,
  description: string,
): ITEM {
  const found = items.filter((item) => matches(item));
  const [item] = found;
  if (item === undefined || found.length !== 1)
    throw new Error(
      `platform-model.json declares ${String(found.length)} entries for ${description}; expected exactly one`,
    );
  return item;
}

/** The tunnel route of a hostname: declared, a static site, or a mail-policy host. */
export function publicHostname(
  hostname: string,
  model: PlatformModel = platformModel,
): PublicHostname {
  return declared(
    publicHostnames(model),
    (entry) => entry.hostname === hostname,
    `public hostname ${hostname}`,
  );
}

/**
 * The one hostname routed to a Service. A Service that serves several is
 * looked up by hostname instead.
 */
export function publicHostnameOfService(
  service: string,
  model: PlatformModel = platformModel,
): PublicHostname {
  return declared(
    publicHostnames(model),
    (entry) => entry.service === service,
    `a public hostname of Service ${service}`,
  );
}

export function staticSite(
  hostname: string,
  model: PlatformModel = platformModel,
): StaticSite {
  return declared(
    model.staticSites,
    (site) => site.hostname === hostname,
    `static site ${hostname}`,
  );
}

/** A tailnet service with the names it is reached on. */
export type ResolvedTailnetService = TailnetService & {
  /** `<host>.<tailnet domain>` */
  fqdn: string;
  /** `https://<fqdn>` */
  origin: string;
};

export function tailnetService(
  host: string,
  model: PlatformModel = platformModel,
): ResolvedTailnetService {
  const service = declared(
    model.tailnetServices,
    (entry) => entry.host === host,
    `tailnet service ${host}`,
  );
  const fqdn = tailnetFqdn(host, model);
  return { ...service, fqdn, origin: `https://${fqdn}` };
}

/**
 * The bucket a namespace's workloads name through `env`. Without a namespace,
 * the bucket every consumer of `env` shares.
 */
export function consumedBucket(
  consumer: { env: string; namespace?: string },
  model: PlatformModel = platformModel,
): string {
  const buckets = new Set(
    model.bucketConsumers
      .filter(
        (entry) =>
          entry.env === consumer.env &&
          (consumer.namespace === undefined ||
            entry.namespace === consumer.namespace),
      )
      .map((entry) => entry.bucket),
  );
  return declared(
    [...buckets],
    () => true,
    `the bucket ${consumer.namespace ?? "every namespace"} names in ${consumer.env}`,
  );
}
