import {
  seaweedfsTailnetS3Endpoint,
  tunnelCnameTarget,
  type PlatformDefinitions,
} from "homelab/src/platform-model.ts";
import type { KubernetesSide } from "./kubernetes-side.ts";
import type { OpenTofuSide } from "./opentofu-side.ts";

/**
 * The "rendered on both sides" rules: each returns the keys that break it.
 *
 * A rule compares the platform model with one rendering. Rules come in pairs,
 * because a fact can be missing from a rendering or rendered without being
 * declared, and the second is how a hostname added on only one side is caught.
 */
export type Sides = {
  definitions: PlatformDefinitions;
  kubernetes: KubernetesSide;
  openTofu: OpenTofuSide;
};

export type RuleId =
  | "publicHostnamesWithoutTunnelBinding"
  | "publicHostnamesWithoutTunnelRecord"
  | "tunnelBindingsWithoutDefinition"
  | "tunnelRecordsWithoutDefinition"
  | "staticSitesWithoutCaddySite"
  | "caddySitesWithoutDefinition"
  | "staticSitesWithoutBucket"
  | "bucketsWithMismatchedExpiry"
  | "zonesWithMismatchedImmutableCache"
  | "tailnetServicesNotRendered"
  | "tailnetDevicesWithoutDefinition"
  | "tailnetTagsMismatched"
  | "tailnetNamesWithoutDefinition"
  | "scopedCredentialsWithoutWriter"
  | "onePasswordWritersWithoutDefinition"
  | "scopedCredentialsWithoutKubernetesReference"
  | "bucketConsumersNotRendered"
  | "bucketEnvironmentWithoutDefinition"
  | "bucketConsumersWithoutBucket"
  | "bucketsWithoutConsumer"
  | "onePasswordItemsOutsideVault"
  | "stateBackendsOffTailnetEndpoint"
  | "seaweedfsEndpointsMismatched";

export type Rule = {
  id: RuleId;
  /** The invariant, as a sentence that is true when nothing is listed. */
  name: string;
  violations: (sides: Sides) => string[];
};

function sameItems(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return (
    JSON.stringify((left ?? []).toSorted()) ===
    JSON.stringify((right ?? []).toSorted())
  );
}

function difference(left: Iterable<string>, right: Iterable<string>): string[] {
  const exclude = new Set(right);
  return [...new Set(left)].filter((item) => !exclude.has(item));
}

function consumerKey(consumer: {
  bucket: string;
  namespace: string;
  env: string;
}): string {
  return `${consumer.bucket}/${consumer.namespace}/${consumer.env}`;
}

/** A SeaweedFS S3 gateway address inside the cluster, whatever its form. */
const IN_CLUSTER_S3 = /\bseaweedfs-s3\.[a-z0-9-]+(?:\.svc\b|:\d)/;

export const RULES: readonly Rule[] = [
  {
    id: "publicHostnamesWithoutTunnelBinding",
    name: "every public hostname has a TunnelBinding to its Service on the tunnel",
    violations: ({ definitions, kubernetes }) => {
      const { cloudflareTunnel } = definitions.model;
      return definitions.publicHostnames
        .filter(
          (definition) =>
            !kubernetes.tunnelBindings.some(
              (binding) =>
                binding.hostname === definition.hostname &&
                binding.namespace === definition.namespace &&
                binding.service === definition.service &&
                binding.tunnel.kind === cloudflareTunnel.kind &&
                binding.tunnel.name === cloudflareTunnel.name,
            ),
        )
        .map((definition) => definition.hostname);
    },
  },
  {
    id: "publicHostnamesWithoutTunnelRecord",
    name: "every public hostname has a proxied Cloudflare CNAME to the tunnel",
    violations: ({ definitions, openTofu }) => {
      const target = tunnelCnameTarget(definitions.model);
      return definitions.publicHostnames
        .filter(
          (definition) =>
            !openTofu.tunnelRecords.some(
              (record) =>
                record.fqdn === definition.hostname &&
                record.target === target &&
                record.proxied,
            ),
        )
        .map((definition) => definition.hostname);
    },
  },
  {
    id: "tunnelBindingsWithoutDefinition",
    name: "every TunnelBinding hostname is a declared public hostname",
    violations: ({ definitions, kubernetes }) =>
      difference(
        kubernetes.tunnelBindings.map((binding) => binding.hostname),
        definitions.publicHostnames.map((definition) => definition.hostname),
      ),
  },
  {
    id: "tunnelRecordsWithoutDefinition",
    name: "every Cloudflare record pointing at a tunnel is a declared public hostname",
    violations: ({ definitions, openTofu }) =>
      difference(
        openTofu.tunnelRecords.map((record) => record.fqdn),
        definitions.publicHostnames.map((definition) => definition.hostname),
      ),
  },
  {
    id: "staticSitesWithoutCaddySite",
    name: "every static site is served from its bucket by the static-site origin",
    violations: ({ definitions, kubernetes }) =>
      definitions.model.staticSites
        .filter(
          (site) =>
            !kubernetes.caddySites.some(
              (rendered) =>
                rendered.hostname === site.hostname &&
                rendered.bucket === site.bucket,
            ),
        )
        .map((site) => site.hostname),
  },
  {
    id: "caddySitesWithoutDefinition",
    name: "every bucket-backed host of the static-site origin is a declared static site",
    violations: ({ definitions, kubernetes }) =>
      difference(
        kubernetes.caddySites
          .filter((site) => site.bucket !== undefined)
          .map((site) => site.hostname),
        definitions.model.staticSites.map((site) => site.hostname),
      ),
  },
  {
    id: "staticSitesWithoutBucket",
    name: "every static site's bucket is declared in the seaweedfs stack",
    violations: ({ definitions, openTofu }) =>
      difference(
        definitions.model.staticSites.map((site) => site.bucket),
        openTofu.seaweedfsBuckets,
      ),
  },
  {
    id: "bucketsWithMismatchedExpiry",
    name: "a bucket expires exactly its static site's immutable prefixes",
    violations: ({ definitions, openTofu }) => {
      const declared = new Map(
        definitions.model.staticSites
          .filter((site) => site.immutablePrefixes.length > 0)
          .map((site) => [site.bucket, site.immutablePrefixes]),
      );
      return [
        ...new Set([
          ...declared.keys(),
          ...openTofu.expiringPrefixesByBucket.keys(),
        ]),
      ].filter(
        (bucket) =>
          !sameItems(
            declared.get(bucket),
            openTofu.expiringPrefixesByBucket.get(bucket),
          ),
      );
    },
  },
  {
    id: "zonesWithMismatchedImmutableCache",
    name: "a Cloudflare zone caches as immutable exactly its static sites' immutable prefixes",
    violations: ({ definitions, openTofu }) =>
      [
        ...new Set([
          ...definitions.immutablePathPrefixesByZone.keys(),
          ...openTofu.immutablePathPrefixesByZone.keys(),
        ]),
      ].filter(
        (zone) =>
          !sameItems(
            definitions.immutablePathPrefixesByZone.get(zone),
            openTofu.immutablePathPrefixesByZone.get(zone),
          ),
      ),
  },
  {
    id: "tailnetServicesNotRendered",
    name: "every tailnet service is rendered with its exposure and tags",
    violations: ({ definitions, kubernetes }) =>
      definitions.model.tailnetServices
        .filter(
          (service) =>
            !kubernetes.tailnetDevices.some(
              (device) =>
                device.namespace === service.namespace &&
                device.exposure === service.exposure &&
                // A tsnet workload names itself; only its tags are rendered.
                (device.host ?? service.host) === service.host &&
                (device.tags === undefined) === (service.tags === undefined) &&
                sameItems(device.tags, service.tags),
            ),
        )
        .map((service) => service.host),
  },
  {
    id: "tailnetDevicesWithoutDefinition",
    name: "every rendered tailnet device is a declared tailnet service",
    violations: ({ definitions, kubernetes }) =>
      kubernetes.tailnetDevices
        .filter(
          (device) =>
            !definitions.model.tailnetServices.some(
              (service) =>
                service.namespace === device.namespace &&
                service.exposure === device.exposure &&
                (device.host ?? service.host) === service.host,
            ),
        )
        .map(
          (device) => `${device.namespace}/${device.host ?? device.exposure}`,
        ),
  },
  {
    id: "tailnetTagsMismatched",
    name: "the tailnet policy assigns an owner to exactly the declared tags",
    violations: ({ definitions, openTofu }) => [
      ...difference(definitions.model.tailnet.tags, openTofu.tailscaleTags),
      ...difference(openTofu.tailscaleTags, definitions.model.tailnet.tags),
    ],
  },
  {
    id: "tailnetNamesWithoutDefinition",
    name: "every tailnet name either side mentions is a declared tailnet service",
    violations: ({ definitions, kubernetes, openTofu }) => {
      const { domain } = definitions.model.tailnet;
      const hosts = new Set(
        definitions.model.tailnetServices.map((service) => service.host),
      );
      const undeclared = (name: { host: string; domain: string }): boolean =>
        name.domain !== domain || !hosts.has(name.host);
      return [
        ...new Set([
          ...kubernetes.tailnetNames
            .filter((name) => undeclared(name))
            .map((name) => `kubernetes: ${name.host}.${name.domain}`),
          ...openTofu.tailnetNames
            .filter((name) => undeclared(name))
            .map(
              (name) => `opentofu ${name.stack}: ${name.host}.${name.domain}`,
            ),
        ]),
      ];
    },
  },
  {
    id: "scopedCredentialsWithoutWriter",
    name: "every scoped credential is written to the operator's vault by its stack",
    violations: ({ definitions, openTofu }) =>
      definitions.scopedCredentials
        .filter(
          (credential) =>
            !openTofu.onePasswordItems.some(
              (item) =>
                item.title === credential.itemTitle &&
                item.stack === credential.writer.stack &&
                item.resource === credential.writer.resource &&
                item.vault === definitions.model.onePassword.vaultId,
            ),
        )
        .map((credential) => credential.itemTitle),
  },
  {
    id: "onePasswordWritersWithoutDefinition",
    name: "every 1Password item a stack writes is a declared scoped credential",
    violations: ({ definitions, openTofu }) =>
      openTofu.onePasswordItems
        .filter(
          (item) =>
            !definitions.scopedCredentials.some(
              (credential) =>
                credential.itemTitle === item.title &&
                credential.writer.stack === item.stack,
            ),
        )
        .map((item) => `${item.stack}/${item.title}`),
  },
  {
    id: "scopedCredentialsWithoutKubernetesReference",
    name: "every scoped credential is read by a OnePasswordItem naming its title",
    violations: ({ definitions, kubernetes }) =>
      definitions.scopedCredentials
        .filter(
          (credential) =>
            !kubernetes.onePasswordItems.some(
              (item) =>
                item.item === credential.itemTitle &&
                (credential.namespace === undefined ||
                  credential.namespace === item.namespace),
            ),
        )
        .map((credential) => credential.itemTitle),
  },
  {
    id: "bucketConsumersNotRendered",
    name: "every bucket consumer's namespace names the bucket in its environment",
    violations: ({ definitions, kubernetes }) =>
      definitions.model.bucketConsumers
        .filter(
          (consumer) =>
            !kubernetes.environment.some(
              (variable) =>
                variable.namespace === consumer.namespace &&
                variable.name === consumer.env &&
                variable.value === consumer.bucket,
            ),
        )
        .map((consumer) => consumerKey(consumer)),
  },
  {
    id: "bucketEnvironmentWithoutDefinition",
    name: "every bucket variable naming a SeaweedFS bucket is a declared consumer",
    violations: ({ definitions, kubernetes, openTofu }) =>
      difference(
        kubernetes.environment
          .filter(
            (variable) =>
              variable.name.includes("BUCKET") &&
              openTofu.seaweedfsBuckets.has(variable.value),
          )
          .map((variable) =>
            consumerKey({
              bucket: variable.value,
              namespace: variable.namespace,
              env: variable.name,
            }),
          ),
        definitions.model.bucketConsumers.map((consumer) =>
          consumerKey(consumer),
        ),
      ),
  },
  {
    id: "bucketConsumersWithoutBucket",
    name: "every consumed bucket is declared in the seaweedfs stack",
    violations: ({ definitions, openTofu }) =>
      difference(
        definitions.model.bucketConsumers.map((consumer) => consumer.bucket),
        openTofu.seaweedfsBuckets,
      ),
  },
  {
    id: "bucketsWithoutConsumer",
    name: "every seaweedfs bucket has a declared static site or consumer",
    violations: ({ definitions, openTofu }) =>
      difference(openTofu.seaweedfsBuckets, [
        ...definitions.model.staticSites.map((site) => site.bucket),
        ...definitions.model.bucketConsumers.map((consumer) => consumer.bucket),
      ]),
  },
  {
    id: "onePasswordItemsOutsideVault",
    name: "every OnePasswordItem reads the operator's vault",
    violations: ({ definitions, kubernetes }) =>
      kubernetes.onePasswordItems
        .filter(
          (item) => item.vaultId !== definitions.model.onePassword.vaultId,
        )
        .map((item) => `${item.namespace}/${item.item}`),
  },
  {
    id: "stateBackendsOffTailnetEndpoint",
    name: "every stack keeps its state at the SeaweedFS tailnet S3 endpoint",
    violations: ({ definitions, openTofu }) =>
      openTofu.stateBackendEndpoints
        .filter(
          (backend) =>
            backend.endpoint !== seaweedfsTailnetS3Endpoint(definitions.model),
        )
        .map((backend) => backend.stack),
  },
  {
    id: "seaweedfsEndpointsMismatched",
    name: "every in-cluster SeaweedFS S3 address is the declared endpoint",
    violations: ({ definitions, kubernetes }) => [
      ...new Set(
        kubernetes.environment
          .filter(
            (variable) =>
              IN_CLUSTER_S3.test(variable.value) &&
              variable.value !==
                definitions.model.seaweedfs.s3InClusterEndpoint,
          )
          .map(
            (variable) =>
              `${variable.namespace}/${variable.name}=${variable.value}`,
          ),
      ),
    ],
  },
];
