import { describe, expect, it } from "bun:test";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createKueueConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { BUILDKITE_MAX_IN_FLIGHT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/buildkite.ts";

const ClusterQueueSchema = z.object({
  apiVersion: z.literal("kueue.x-k8s.io/v1beta1"),
  kind: z.literal("ClusterQueue"),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z
    .object({
      resourceGroups: z.array(
        z
          .object({
            coveredResources: z.array(z.string()),
            flavors: z.array(
              z
                .object({
                  resources: z.array(
                    z
                      .object({ name: z.string(), nominalQuota: z.string() })
                      .loose(),
                  ),
                })
                .loose(),
            ),
          })
          .loose(),
      ),
    })
    .loose(),
});

function synthKueueClusterQueue(): z.infer<typeof ClusterQueueSchema> {
  const app = new App();
  const chart = new Chart(app, "test", {});
  createKueueConfig(chart);

  const documents = app
    .synthYaml()
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .map((document): unknown => parseYaml(document));

  for (const document of documents) {
    const result = ClusterQueueSchema.safeParse(document);
    if (result.success) return result.data;
  }
  throw new Error("Kueue ClusterQueue was not synthesized");
}

describe("kueue-config", () => {
  it("covers pods as a resource, alongside cpu and memory", () => {
    const clusterQueue = synthKueueClusterQueue();
    const group = clusterQueue.spec.resourceGroups[0];
    expect(group).toBeDefined();
    expect(group?.coveredResources).toContain("pods");
    expect(group?.coveredResources).toContain("cpu");
    expect(group?.coveredResources).toContain("memory");
  });

  it("pods nominalQuota stays in lockstep with Buildkite's max-in-flight", () => {
    const clusterQueue = synthKueueClusterQueue();
    const flavor = clusterQueue.spec.resourceGroups[0]?.flavors[0];
    expect(flavor).toBeDefined();
    const podsResource = flavor?.resources.find((r) => r.name === "pods");
    expect(podsResource).toBeDefined();
    // Two independent enforcement layers (Buildkite max-in-flight, Kueue pods
    // quota) for the same concurrency cap must never drift apart — see the
    // long comment in kueue-config.ts / buildkite.ts for why both exist.
    expect(podsResource?.nominalQuota).toBe(String(BUILDKITE_MAX_IN_FLIGHT));
  });
});
