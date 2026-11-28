import { beforeEach, describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createFeedsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/feeds.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { FEEDS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/feeds/index.ts";

const K8sManifestHeaderSchema = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
});

beforeEach(resetProbeRegistry);

describe("feeds cdk8s chart", () => {
  test("is active by default and renders console + public reader services, tunnel binding, PVC, and network policy", () => {
    expect(FEEDS_ACTIVE).toBe(true);
    const summaries = z
      .array(K8sManifestHeaderSchema)
      .parse(createFeedsChart(new App()).toJson())
      .map((obj) => `${obj.kind}/${obj.metadata.name}`);

    expect(summaries).toEqual(
      expect.arrayContaining([
        "Namespace/feeds",
        "Service/feeds",
        "Service/feeds-reader-service",
        "OnePasswordItem/feeds-auth",
        "PersistentVolumeClaim/feeds-data",
        "NetworkPolicy/feeds-app-netpol",
      ]),
    );
    expect(summaries.some((entry) => entry.startsWith("Deployment/"))).toBe(
      true,
    );
    expect(summaries.some((entry) => entry.startsWith("Ingress/"))).toBe(true);
    expect(summaries.some((entry) => entry.startsWith("TunnelBinding/"))).toBe(
      true,
    );
  });

  test("provisions feeds-postgresql beside a Deployment that does not depend on it yet", () => {
    const manifests = z
      .array(K8sManifestHeaderSchema)
      .parse(createFeedsChart(new App()).toJson());
    const summaries = manifests.map(
      (obj) => `${obj.kind}/${obj.metadata.name}`,
    );
    expect(summaries).toEqual(
      expect.arrayContaining([
        "postgresql/feeds-postgresql",
        "NetworkPolicy/feeds-pg-netpol",
        "PersistentVolumeClaim/feeds-data",
      ]),
    );

    // The operator creates the credentials Secret only once the cluster is
    // up. The pod must start without it, so nothing in the Deployment may
    // reference it (no optional refs either) and no container may wait on
    // the database.
    const deployment = JSON.stringify(
      manifests.find((obj) => obj.kind === "Deployment"),
    );
    expect(deployment).not.toContain("feeds-postgresql");
    expect(deployment).not.toContain("DATABASE_URL");
    expect(deployment).not.toContain("initContainers");
    expect(deployment).toContain("/var/lib/feeds/feeds.sqlite");
  });

  test("emits only the inactive ConfigMap marker when explicitly gated off", () => {
    const rendered = createFeedsChart(new App(), false).toJson();
    expect(rendered).toEqual([
      expect.objectContaining({
        kind: "ConfigMap",
        metadata: expect.objectContaining({ namespace: "feeds" }),
        data: { active: "false" },
      }),
    ]);
  });
});
