import { expect, test } from "bun:test";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createOpenRouterBroadcastIngestDeployment } from "./index.ts";

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z
            .object({
              name: z.string(),
              securityContext: z
                .object({
                  allowPrivilegeEscalation: z.literal(false),
                  capabilities: z.object({ drop: z.tuple([z.literal("ALL")]) }),
                  privileged: z.literal(false),
                  readOnlyRootFilesystem: z.literal(true),
                  runAsGroup: z.literal(1000),
                  runAsNonRoot: z.literal(true),
                  runAsUser: z.literal(1000),
                  seccompProfile: z.object({
                    type: z.literal("RuntimeDefault"),
                  }),
                })
                .loose(),
            })
            .loose(),
        ),
      }),
    }),
  }),
});

test("synthesizes authenticated archive, Tempo, monitoring, and ingress wiring", () => {
  const app = new App();
  const chart = new Chart(app, "test", {
    namespace: "openrouter-broadcast-ingest",
    disableResourceNameHashes: true,
  });
  createOpenRouterBroadcastIngestDeployment(chart);
  const manifests = JSON.stringify(Testing.synth(chart));

  expect(manifests).toContain("OPENROUTER_BROADCAST_BEARER_TOKEN");
  expect(manifests).toContain("SEAWEEDFS_ACCESS_KEY_ID");
  expect(manifests).toContain("seaweedfs-s3.seaweedfs.svc.cluster.local:8333");
  expect(manifests).toContain("tempo.tempo.svc.cluster.local:4318/v1/traces");
  expect(manifests).toContain("openrouter-broadcast.sjer.red");
  expect(manifests).toContain("ServiceMonitor");
  expect(manifests).toContain('"readOnlyRootFilesystem":true');

  const deployment = Testing.synth(chart)
    .map((manifest) => DeploymentSchema.safeParse(manifest))
    .find((result) => result.success)?.data;
  if (deployment === undefined) {
    throw new Error("Missing Deployment/openrouter-broadcast-ingest manifest");
  }
  const container = deployment.spec.template.spec.containers.find(
    (candidate) => candidate.name === "openrouter-broadcast-ingest",
  );
  if (container === undefined) {
    throw new Error("Missing openrouter-broadcast-ingest container");
  }
  expect(container.securityContext).toMatchObject({
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    privileged: false,
    readOnlyRootFilesystem: true,
    runAsGroup: 1000,
    runAsNonRoot: true,
    runAsUser: 1000,
    seccompProfile: { type: "RuntimeDefault" },
  });
});
