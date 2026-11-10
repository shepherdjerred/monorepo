import { describe, expect, test } from "vitest";
import { mailPolicyHosts } from "homelab/src/domain-registry.ts";
import modelJson from "homelab/src/platform-model.json" with { type: "json" };
import {
  PlatformModelSchema,
  immutablePathPrefixesByZone,
  platformModel,
  publicHostnames,
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
