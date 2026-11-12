import { describe, expect, test } from "vitest";
import { mailPolicyHosts } from "homelab/src/domain-registry.ts";
import modelJson from "homelab/src/platform-model.json" with { type: "json" };
import {
  PlatformModelSchema,
  consumedBucket,
  declaredBuckets,
  immutablePathPrefixesByZone,
  immutablePrefixesByBucket,
  platformModel,
  publicHostname,
  publicHostnameOfService,
  publicHostnames,
  staticSite,
  tailnetService,
  scopedCredentials,
  seaweedfsTailnetS3Endpoint,
  tunnelCnameTarget,
  zoneOf,
} from "homelab/src/platform-model.ts";

describe("platform model", () => {
  test("public hostnames include every static site and mail-policy host", () => {
    const hostnames = publicHostnames();
    expect(hostnames).toHaveLength(
      platformModel.publicHostnames.length +
        platformModel.staticSites.length +
        mailPolicyHosts.length,
    );
    for (const hostname of [
      ...platformModel.staticSites.map((site) => site.hostname),
      ...mailPolicyHosts.map((host) => host.hostname),
    ])
      expect(hostnames).toContainEqual({
        hostname,
        ...platformModel.staticSiteOrigin,
      });
  });

  test("a hostname belongs to its longest matching zone", () => {
    expect(zoneOf("sjer.red")).toBe("sjer.red");
    expect(zoneOf("docs.ts-mc.net")).toBe("ts-mc.net");
    expect(zoneOf("beta.scout-for-lol.com")).toBe("scout-for-lol.com");
    expect(() => zoneOf("example.org")).toThrow(/no managed Cloudflare zone/);
  });

  test("a zone caches the immutable prefixes of all its static sites", () => {
    const byZone = immutablePathPrefixesByZone();
    expect(byZone.get("scout-for-lol.com")).toEqual([
      "/_astro/",
      "/app/assets/",
    ]);
    expect(byZone.get("better-skill-capped.com")).toEqual(["/assets/"]);
    expect(byZone.has("statically-typed.com")).toBe(false);
  });

  test("a bucket expires the immutable prefixes of the site it serves", () => {
    const byBucket = immutablePrefixesByBucket();
    expect(byBucket.get("scout-frontend")).toEqual(["app/assets/", "_astro/"]);
    expect(byBucket.has("statically-typed")).toBe(false);
  });

  test("declared buckets are every static site's and consumer's, once", () => {
    const buckets = declaredBuckets();
    // A static site, a consumer, and a bucket that is both.
    expect(buckets).toContain("resume");
    expect(buckets).toContain("llm-archive");
    expect(
      buckets.filter((bucket) => bucket === "better-skill-capped"),
    ).toHaveLength(1);
    expect(buckets).toEqual(buckets.toSorted());
  });

  test("scoped credentials include the desired-state workloads", () => {
    const titles = scopedCredentials().map(
      (credential) => credential.itemTitle,
    );
    expect(titles).toContain("delivery-argocd-token");
    expect(scopedCredentials()).toContainEqual({
      itemTitle: "llm-anthropic-federation-scout-prod",
      writer: {
        stack: "anthropic-federation",
        resource: "onepassword_item.workload_identity",
      },
      namespace: "scout-prod",
    });
    expect(new Set(titles).size).toBe(titles.length);
  });

  test("endpoints are derived from the declared constants", () => {
    expect(tunnelCnameTarget()).toBe(
      `${platformModel.cloudflareTunnel.id}.cfargotunnel.com`,
    );
    expect(seaweedfsTailnetS3Endpoint()).toBe(
      `https://seaweedfs-s3.${platformModel.tailnet.domain}`,
    );
  });

  test.each<[string, (model: typeof modelJson) => unknown, RegExp]>([
    [
      "a duplicate public hostname",
      (model) => ({
        ...model,
        publicHostnames: [...model.publicHostnames, model.publicHostnames[0]],
      }),
      /Duplicate public hostname/,
    ],
    [
      "two static sites sharing a bucket",
      (model) => ({
        ...model,
        staticSites: [
          ...model.staticSites,
          { hostname: "other.sjer.red", bucket: "cook", immutablePrefixes: [] },
        ],
      }),
      /Duplicate static site bucket/,
    ],
    [
      "a service tag the tailnet does not declare",
      (model) => ({
        ...model,
        tailnetServices: [
          ...model.tailnetServices,
          {
            host: "new",
            namespace: "new",
            exposure: "ingress",
            tags: ["tag:unknown"],
          },
        ],
      }),
      /Tags missing from tailnet.tags: tag:unknown/,
    ],
    [
      "an S3 tailnet host that is not a tailnet service",
      (model) => ({
        ...model,
        seaweedfs: { ...model.seaweedfs, s3TailnetHost: "elsewhere" },
      }),
      /is not a tailnet service/,
    ],
    [
      "an unknown field",
      (model) => ({ ...model, extra: true }),
      /Unrecognized key/,
    ],
  ])("the schema rejects %s", (_name, change, message) => {
    expect(() => PlatformModelSchema.parse(change(modelJson))).toThrow(message);
  });
});

describe("platform model lookups", () => {
  test("resolve a declared id to its definition", () => {
    expect(publicHostname("plex.sjer.red")).toEqual({
      hostname: "plex.sjer.red",
      namespace: "media",
      service: "media-plex-service",
    });
    expect(publicHostnameOfService("media-plex-service").hostname).toBe(
      "plex.sjer.red",
    );
    // Static sites and mail-policy hosts are routed to the static-site origin.
    expect(publicHostname("sjer.red")).toMatchObject(
      platformModel.staticSiteOrigin,
    );
    expect(publicHostname(mailPolicyHosts[0]?.hostname ?? "")).toMatchObject(
      platformModel.staticSiteOrigin,
    );
    expect(staticSite("sjer.red").bucket).toBe("sjer-red");
    expect(tailnetService("delivery")).toMatchObject({
      namespace: "delivery",
      tags: ["tag:delivery"],
      fqdn: `delivery.${platformModel.tailnet.domain}`,
      origin: `https://delivery.${platformModel.tailnet.domain}`,
    });
    expect(consumedBucket({ env: "S3_BUCKET", namespace: "tracker" })).toBe(
      "tracker-attachments",
    );
    expect(consumedBucket({ env: "LLM_ARCHIVE_S3_BUCKET" })).toBe(
      "llm-archive",
    );
  });

  test.each([
    ["an undeclared hostname", () => publicHostname("nowhere.sjer.red")],
    ["a Service with no hostname", () => publicHostnameOfService("nothing")],
    [
      "a Service with several hostnames",
      () => publicHostnameOfService("minecraft-tsmc-bluemap"),
    ],
    ["an undeclared static site", () => staticSite("nowhere.sjer.red")],
    ["an undeclared tailnet service", () => tailnetService("nowhere")],
    [
      "a bucket variable the namespace does not consume",
      () => consumedBucket({ env: "S3_BUCKET", namespace: "media" }),
    ],
    [
      "a bucket variable whose consumers name different buckets",
      () => consumedBucket({ env: "S3_BUCKET_NAME" }),
    ],
  ])("%s throws instead of falling back", (_name, lookup) => {
    expect(lookup).toThrow(/platform-model\.json declares \d+ entries/);
  });
});
