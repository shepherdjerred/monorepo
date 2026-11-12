import { describe, expect, test } from "vitest";
import {
  PlatformModelSchema,
  tunnelCnameTarget,
  type PlatformDefinitions,
} from "homelab/src/platform-model.ts";
import type { KubernetesSide } from "./kubernetes-side.ts";
import type { OpenTofuSide } from "./opentofu-side.ts";
import { RULES, type RuleId, type Sides } from "./rules.ts";
import { caddySitesIn } from "./kubernetes-side.ts";

/**
 * The rules against a small platform both sides agree on, then against one
 * disagreement at a time: each must be reported by exactly the rule for it.
 */

const model = PlatformModelSchema.parse({
  cloudflareTunnel: {
    name: "tunnel",
    kind: "ClusterTunnel",
    id: "11111111-2222-4333-8444-555555555555",
  },
  tailnet: {
    domain: "example.ts.net",
    defaultProxyTags: ["tag:k8s"],
    tags: ["tag:k8s", "tag:special"],
  },
  seaweedfs: {
    namespace: "seaweedfs",
    s3InClusterEndpoint: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    s3TailnetHost: "seaweedfs-s3",
  },
  onePassword: {
    vaultId: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
    vaultName: "Vault",
  },
  staticSiteOrigin: { namespace: "sites", service: "sites" },
  publicHostnames: [
    { hostname: "app.example.com", namespace: "app", service: "app-web" },
  ],
  staticSites: [
    {
      hostname: "www.example.com",
      bucket: "www",
      immutablePrefixes: ["_astro/"],
    },
  ],
  tailnetServices: [
    { host: "seaweedfs-s3", namespace: "seaweedfs", exposure: "ingress" },
    {
      host: "special",
      namespace: "app",
      exposure: "ingress",
      tags: ["tag:special"],
    },
  ],
  scopedCredentials: [
    {
      itemTitle: "app-token",
      writer: { stack: "tokens", resource: "onepassword_item.app" },
      namespace: "app",
    },
  ],
  bucketConsumers: [{ bucket: "uploads", namespace: "app", env: "S3_BUCKET" }],
});

const definitions: PlatformDefinitions = {
  model,
  publicHostnames: [
    ...model.publicHostnames,
    { hostname: "www.example.com", ...model.staticSiteOrigin },
  ],
  scopedCredentials: model.scopedCredentials,
  immutablePathPrefixesByZone: new Map([["example.com", ["/_astro/"]]]),
};

const kubernetes: KubernetesSide = {
  tunnelBindings: [
    {
      namespace: "app",
      hostname: "app.example.com",
      service: "app-web",
    },
    {
      namespace: "sites",
      hostname: "www.example.com",
      service: "sites",
    },
  ],
  caddySites: [{ hostname: "www.example.com", bucket: "www" }],
  tailnetDevices: [
    {
      namespace: "seaweedfs",
      host: "seaweedfs-s3",
      exposure: "ingress",
      tags: undefined,
    },
    {
      namespace: "app",
      host: "special",
      exposure: "ingress",
      tags: ["tag:special"],
    },
  ],
  onePasswordItems: [
    { namespace: "app", vaultId: model.onePassword.vaultId, item: "app-token" },
  ],
  environment: [
    { namespace: "app", name: "S3_BUCKET", value: "uploads" },
    {
      namespace: "app",
      name: "S3_ENDPOINT",
      value: model.seaweedfs.s3InClusterEndpoint,
    },
  ],
  tailnetNames: [{ host: "special", domain: "example.ts.net" }],
};

const target = tunnelCnameTarget(model);
const openTofu: OpenTofuSide = {
  tunnelRecords: [
    { address: "a", fqdn: "app.example.com", target, proxied: true },
    { address: "b", fqdn: "www.example.com", target, proxied: true },
  ],
  immutablePathPrefixesByZone: new Map([["example.com", ["/_astro/"]]]),
  seaweedfsBuckets: new Set(["www", "uploads"]),
  expiringPrefixesByBucket: new Map([["www", ["_astro/"]]]),
  tailscaleTags: new Set(["tag:k8s", "tag:special"]),
  onePasswordItems: [
    {
      stack: "tokens",
      resource: "onepassword_item.app",
      title: "app-token",
      vault: model.onePassword.vaultId,
    },
  ],
  tailnetNames: [
    { stack: "tokens", host: "seaweedfs-s3", domain: "example.ts.net" },
  ],
  stateBackendEndpoints: [
    { stack: "tokens", endpoint: "https://seaweedfs-s3.example.ts.net" },
  ],
};

const agreed: Sides = { definitions, kubernetes, openTofu };

function violations(sides: Sides): Partial<Record<RuleId, string[]>> {
  return Object.fromEntries(
    RULES.map((rule) => [rule.id, rule.violations(sides)] as const).filter(
      ([, keys]) => keys.length > 0,
    ),
  );
}

const DISAGREEMENTS: [string, Sides, Partial<Record<RuleId, string[]>>][] = [
  [
    "a tunnel hostname with no DNS record",
    {
      ...agreed,
      openTofu: {
        ...openTofu,
        tunnelRecords: openTofu.tunnelRecords.filter(
          (record) => record.fqdn !== "app.example.com",
        ),
      },
    },
    { publicHostnamesWithoutTunnelRecord: ["app.example.com"] },
  ],
  [
    "a DNS record that points at another tunnel",
    {
      ...agreed,
      openTofu: {
        ...openTofu,
        tunnelRecords: openTofu.tunnelRecords.map((record) =>
          record.fqdn === "app.example.com"
            ? { ...record, target: "other.cfargotunnel.com" }
            : record,
        ),
      },
    },
    { publicHostnamesWithoutTunnelRecord: ["app.example.com"] },
  ],
  [
    "a DNS record with no tunnel hostname",
    {
      ...agreed,
      openTofu: {
        ...openTofu,
        tunnelRecords: [
          ...openTofu.tunnelRecords,
          { address: "c", fqdn: "old.example.com", target, proxied: true },
        ],
      },
    },
    { tunnelRecordsWithoutDefinition: ["old.example.com"] },
  ],
  [
    "a TunnelBinding nobody declared",
    {
      ...agreed,
      kubernetes: {
        ...kubernetes,
        tunnelBindings: [
          ...kubernetes.tunnelBindings,
          {
            namespace: "app",
            hostname: "new.example.com",
            service: "app-web",
          },
        ],
      },
    },
    { tunnelBindingsWithoutDefinition: ["new.example.com"] },
  ],
  [
    "a declared hostname bound to a different Service",
    {
      ...agreed,
      kubernetes: {
        ...kubernetes,
        tunnelBindings: kubernetes.tunnelBindings.map((binding) =>
          binding.hostname === "app.example.com"
            ? { ...binding, service: "other" }
            : binding,
        ),
      },
    },
    { publicHostnamesWithoutTunnelBinding: ["app.example.com"] },
  ],
  [
    "a static site served from a different bucket",
    {
      ...agreed,
      kubernetes: {
        ...kubernetes,
        caddySites: [{ hostname: "www.example.com", bucket: "elsewhere" }],
      },
    },
    { staticSitesWithoutCaddySite: ["www.example.com"] },
  ],
  [
    "a static site whose bucket and cache rule are missing",
    {
      ...agreed,
      openTofu: {
        ...openTofu,
        seaweedfsBuckets: new Set(["uploads"]),
        expiringPrefixesByBucket: new Map(),
        immutablePathPrefixesByZone: new Map(),
      },
    },
    {
      staticSitesWithoutBucket: ["www"],
      bucketsWithMismatchedExpiry: ["www"],
      zonesWithMismatchedImmutableCache: ["example.com"],
    },
  ],
  [
    "a tailnet service rendered without its tags",
    {
      ...agreed,
      kubernetes: {
        ...kubernetes,
        tailnetDevices: kubernetes.tailnetDevices.map((device) => ({
          ...device,
          tags: undefined,
        })),
      },
    },
    { tailnetServicesNotRendered: ["special"] },
  ],
  [
    "an ingress and a tag nobody declared",
    {
      ...agreed,
      kubernetes: {
        ...kubernetes,
        tailnetDevices: [
          ...kubernetes.tailnetDevices,
          {
            namespace: "app",
            host: "extra",
            exposure: "ingress",
            tags: undefined,
          },
        ],
        tailnetNames: [{ host: "extra", domain: "example.ts.net" }],
      },
      openTofu: {
        ...openTofu,
        tailscaleTags: new Set(["tag:k8s", "tag:special", "tag:new"]),
      },
    },
    {
      tailnetDevicesWithoutDefinition: ["app/extra"],
      tailnetTagsMismatched: ["tag:new"],
      tailnetNamesWithoutDefinition: ["kubernetes: extra.example.ts.net"],
    },
  ],
  [
    "a credential read with no writer, and a writer nobody declared",
    {
      ...agreed,
      openTofu: {
        ...openTofu,
        onePasswordItems: [
          {
            stack: "tokens",
            resource: "onepassword_item.other",
            title: "other-token",
            vault: model.onePassword.vaultId,
          },
        ],
      },
    },
    {
      scopedCredentialsWithoutWriter: ["app-token"],
      onePasswordWritersWithoutDefinition: ["tokens/other-token"],
    },
  ],
  [
    "a credential read in the wrong namespace and vault",
    {
      ...agreed,
      kubernetes: {
        ...kubernetes,
        onePasswordItems: [
          { namespace: "other", vaultId: "wrong", item: "app-token" },
        ],
      },
    },
    {
      scopedCredentialsWithoutKubernetesReference: ["app-token"],
      onePasswordItemsOutsideVault: ["other/app-token"],
    },
  ],
  [
    "a bucket variable nobody declared, and endpoints off the model",
    {
      ...agreed,
      kubernetes: {
        ...kubernetes,
        environment: [
          { namespace: "other", name: "DATA_BUCKET", value: "uploads" },
          {
            namespace: "other",
            name: "S3_ENDPOINT",
            value: "http://seaweedfs-s3.seaweedfs:8333",
          },
        ],
      },
      openTofu: {
        ...openTofu,
        stateBackendEndpoints: [
          { stack: "tokens", endpoint: "https://s3.example.com" },
        ],
      },
    },
    {
      bucketConsumersNotRendered: ["uploads/app/S3_BUCKET"],
      bucketEnvironmentWithoutDefinition: ["uploads/other/DATA_BUCKET"],
      stateBackendsOffTailnetEndpoint: ["tokens"],
      seaweedfsEndpointsMismatched: [
        "other/S3_ENDPOINT=http://seaweedfs-s3.seaweedfs:8333",
      ],
    },
  ],
  [
    "a consumed bucket the stack does not declare, and an unused one",
    {
      ...agreed,
      openTofu: { ...openTofu, seaweedfsBuckets: new Set(["www", "spare"]) },
    },
    {
      bucketConsumersWithoutBucket: ["uploads"],
      bucketsWithoutConsumer: ["spare"],
    },
  ],
];

describe("rendered-on-both-sides rules", () => {
  test("nothing is reported when both sides render every definition", () => {
    expect(violations(agreed)).toEqual({});
  });

  test.each(DISAGREEMENTS)("%s", (_name, sides, expected) => {
    expect(violations(sides)).toEqual(expected);
  });
});

describe("caddySitesIn", () => {
  test("reads each site block's host and bucket", () => {
    const caddyfile = [
      "{",
      "\tauto_https off",
      "}",
      "",
      "http://www.example.com {",
      "\thandle {",
      "\t\ts3proxy {",
      "\t\t\tbucket www",
      "\t\t}",
      "\t}",
      "}",
      "",
      "http://mta-sts.example.com {",
      '\trespond "version: STSv1"',
      "}",
    ].join("\n");
    expect(caddySitesIn(caddyfile)).toEqual([
      { hostname: "www.example.com", bucket: "www" },
      { hostname: "mta-sts.example.com", bucket: undefined },
    ]);
  });
});
