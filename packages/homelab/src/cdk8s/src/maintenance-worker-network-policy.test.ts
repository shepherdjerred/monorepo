import { describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createMediaChart } from "./cdk8s-charts/media.ts";
import { MAINTENANCE_IMAGE_READY } from "./resources/argo-applications/maintenance-image-readiness.ts";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";

const NetworkPolicySchema = z
  .object({
    kind: z.literal("NetworkPolicy"),
    metadata: z.object({ name: z.string() }),
    spec: z
      .object({
        ingress: z
          .array(
            z
              .object({
                from: z
                  .array(
                    z
                      .object({
                        namespaceSelector: z
                          .object({
                            matchLabels: z.record(z.string(), z.string()),
                          })
                          .optional(),
                        podSelector: z
                          .object({
                            matchLabels: z
                              .record(z.string(), z.string())
                              .optional(),
                          })
                          .optional(),
                      })
                      .loose(),
                  )
                  .optional(),
                ports: z
                  .array(
                    z
                      .object({ port: z.union([z.number(), z.string()]) })
                      .loose(),
                  )
                  .optional(),
              })
              .loose(),
          )
          .optional(),
      })
      .loose(),
  })
  .loose();

const NamedResourceSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }).loose().optional(),
});

function documents(yamlContent: string): unknown[] {
  return yamlContent
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0)
    .map((document) => parseYaml(document));
}

function maintenanceIngressAllowed(
  policy: z.infer<typeof NetworkPolicySchema>,
  port: number,
): boolean {
  return (policy.spec.ingress ?? []).some((entry) => {
    const fromMaintenanceWorker = (entry.from ?? []).some((source) => {
      return (
        source.namespaceSelector?.matchLabels["kubernetes.io/metadata.name"] ===
          "buildkite" &&
        source.podSelector?.matchLabels?.["app"] ===
          "temporal-maintenance-worker"
      );
    });
    const hasPort = (entry.ports ?? []).some(
      (candidatePort) => String(candidatePort.port) === String(port),
    );
    return fromMaintenanceWorker && hasPort;
  });
}

describe("maintenance worker network boundary", () => {
  it("allows only the required Temporal and Plex ports and preserves namespace init", async () => {
    const app = new App({ outdir: ".test-synth-maintenance-network" });
    createTemporalChart(app);
    await createMediaChart(app);
    const resources = documents(app.synthYaml());
    const policies = resources.flatMap((resource) => {
      const result = NetworkPolicySchema.safeParse(resource);
      return result.success ? [result.data] : [];
    });
    const temporalPolicy = policies.find(
      (policy) => policy.metadata.name === "temporal-server-netpol",
    );
    const mediaPolicy = policies.find(
      (policy) => policy.metadata.name === "media-ingress-policy",
    );
    if (temporalPolicy === undefined || mediaPolicy === undefined) {
      throw new Error("maintenance network policies were not synthesized");
    }
    expect(maintenanceIngressAllowed(temporalPolicy, 7233)).toBe(true);
    expect(maintenanceIngressAllowed(mediaPolicy, 32_400)).toBe(true);

    const namedResources = resources.flatMap((resource) => {
      const result = NamedResourceSchema.safeParse(resource);
      return result.success ? [result.data] : [];
    });
    const jobs = namedResources.filter((resource) => resource.kind === "Job");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.metadata?.name).toBe("temporal-namespace-init");
    expect(
      namedResources.filter((resource) => resource.kind === "CronJob"),
    ).toHaveLength(MAINTENANCE_IMAGE_READY ? 0 : 1);
  });
});
