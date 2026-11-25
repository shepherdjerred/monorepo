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
