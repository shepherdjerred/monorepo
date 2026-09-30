import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResourcesWithActivityWorkerTopology,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";
import { SCOUT_ACTIVITY_WORKER_TOPOLOGY } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";

const DeploymentSchema = z.looseObject({
  metadata: z.looseObject({
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.looseObject({
    replicas: z.number(),
    template: z.looseObject({
      metadata: z.looseObject({ labels: z.record(z.string(), z.string()) }),
      spec: z.looseObject({
        securityContext: z.looseObject({
          seLinuxOptions: z.looseObject({ level: z.string() }),
        }),
        affinity: z
          .looseObject({
            podAffinity: z.looseObject({
              requiredDuringSchedulingIgnoredDuringExecution: z
                .array(z.looseObject({ topologyKey: z.string() }))
                .nonempty(),
            }),
          })
          .optional(),
        containers: z.array(
          z.looseObject({
            image: z.string(),
            env: z.array(
              z.looseObject({ name: z.string(), value: z.string().optional() }),
            ),
            volumeMounts: z.array(
              z.looseObject({
                mountPath: z.string(),
                readOnly: z.boolean().optional(),
              }),
            ),
          }),
        ),
        volumes: z.array(
          z.looseObject({
            persistentVolumeClaim: z
              .looseObject({
                claimName: z.string(),
                readOnly: z.boolean().optional(),
              })
              .optional(),
          }),
        ),
      }),
    }),
  }),
});

function resources(
  stage: "beta" | "prod",
  topology: "observing" | "owning" | "retiring",
) {
  return scoutResourcesWithActivityWorkerTopology(stage, "split", topology);
}

function deployment(
  stage: "beta" | "prod",
  topology: "observing" | "owning" | "retiring",
  name: "scout-backend" | "scout-activity-worker",
) {
  return DeploymentSchema.parse(
    findResource(
      resources(stage, topology),
      "Deployment",
      `scout-${stage}-${name}`,
    ),
  );
}

function runtimeRole(
  value: z.infer<typeof DeploymentSchema>,
): string | undefined {
  return value.spec.template.spec.containers[0]?.env.find(
    (entry) => entry.name === "SCOUT_RUNTIME_ROLE",
  )?.value;
}

describe("Scout activity worker topology", () => {
  test("both stages assign activity ownership to the worker", () => {
    expect(SCOUT_ACTIVITY_WORKER_TOPOLOGY).toEqual({
      beta: "owning",
      prod: "owning",
    });
  });

  test("observing keeps interim application queues while admitting a ready worker", () => {
    const backend = deployment("beta", "observing", "scout-backend");
    const worker = deployment("beta", "observing", "scout-activity-worker");
    expect(runtimeRole(backend)).toBe("application");
    expect(runtimeRole(worker)).toBe("activity-worker");
    expect(worker.spec.replicas).toBe(1);
    expect(worker.metadata.annotations?.["argocd.argoproj.io/sync-wave"]).toBe(
      "1",
    );
    expect(worker.spec.template.spec.containers[0]?.image).toBe(
      backend.spec.template.spec.containers[0]?.image,
    );
  });

  test("owning leaves the worker as the sole realtime and competition owner", () => {
    for (const stage of ["beta", "prod"] as const) {
      expect(runtimeRole(deployment(stage, "owning", "scout-backend"))).toBe(
        "application-isolated",
      );
      expect(
        runtimeRole(deployment(stage, "owning", "scout-activity-worker")),
      ).toBe("activity-worker");
    }
  });

  test("worker has a same-node writable lake mount and matching SELinux level", () => {
    const backend = deployment("beta", "observing", "scout-backend");
    const worker = deployment("beta", "observing", "scout-activity-worker");
    const workerSpec = worker.spec.template.spec;
    const backendSpec = backend.spec.template.spec;
    expect(
      workerSpec.affinity?.podAffinity
        .requiredDuringSchedulingIgnoredDuringExecution,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topologyKey: "kubernetes.io/hostname" }),
      ]),
    );
    expect(workerSpec.securityContext.seLinuxOptions.level).toBe(
      backendSpec.securityContext.seLinuxOptions.level,
    );
    const workerClaim = workerSpec.volumes.find(
      (volume) => volume.persistentVolumeClaim,
    );
    const backendClaim = backendSpec.volumes.find(
      (volume) => volume.persistentVolumeClaim,
    );
    expect(workerClaim?.persistentVolumeClaim?.claimName).toBe(
      backendClaim?.persistentVolumeClaim?.claimName,
    );
    expect(workerClaim?.persistentVolumeClaim?.readOnly).not.toBe(true);
    expect(
      workerSpec.containers[0]?.volumeMounts.find(
        (mount) => mount.mountPath === "/data",
      )?.readOnly,
    ).not.toBe(true);
  });

  test("worker is scraped and governed by its stage policy", () => {
    const rendered = resources("beta", "observing");
    const service = findResource(
      rendered,
      "Service",
      "scout-activity-worker-service-beta",
    );
    expect(service.metadata["labels"]).toEqual({
      app: "scout-activity-worker",
      stage: "beta",
    });
    const monitor = findResource(
      rendered,
      "ServiceMonitor",
      "scout-activity-worker-beta-service-monitor",
    );
    expect(monitor.spec).toEqual(
      expect.objectContaining({
        selector: {
          matchLabels: { app: "scout-activity-worker", stage: "beta" },
        },
      }),
    );
    const policy = findResource(
      rendered,
      "NetworkPolicy",
      "scout-activity-worker-netpol",
    );
    expect(policy.spec).toEqual(
      expect.objectContaining({
        podSelector: { matchLabels: { app: "scout-activity-worker" } },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          {
            from: [
              {
                namespaceSelector: {
                  matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
                },
              },
            ],
            ports: [{ port: 3000, protocol: "TCP" }],
          },
        ],
        egress: expect.arrayContaining([
          expect.objectContaining({
            ports: [{ port: 7233, protocol: "TCP" }],
          }),
        ]),
      }),
    );
  });

  test("worker has bounded resources and admin health probes", () => {
    const worker = deployment("beta", "observing", "scout-activity-worker");
    const container = worker.spec.template.spec.containers[0];
    expect(container?.["resources"]).toEqual({
      requests: { cpu: "50m", memory: "3072Mi" },
      limits: { memory: "8192Mi" },
    });
    expect(container?.["startupProbe"]).toEqual(
      expect.objectContaining({
        httpGet: { path: "/ping", port: 3000, scheme: "HTTP" },
      }),
    );
    expect(container?.["livenessProbe"]).toEqual(
      expect.objectContaining({
        httpGet: { path: "/livez", port: 3000, scheme: "HTTP" },
      }),
    );
    expect(container?.["readinessProbe"]).toEqual(
      expect.objectContaining({
        httpGet: { path: "/healthz", port: 3000, scheme: "HTTP" },
      }),
    );
  });

  test("retirement waits for pod exit before the backend reclaims queues", () => {
    const rendered = resources("beta", "retiring");
    const worker = deployment("beta", "retiring", "scout-activity-worker");
    expect(runtimeRole(deployment("beta", "retiring", "scout-backend"))).toBe(
      "application",
    );
    expect(worker.spec.replicas).toBe(0);
    expect(worker.metadata.annotations?.["argocd.argoproj.io/sync-wave"]).toBe(
      "-2",
    );
    const gate = z
      .object({
        metadata: z.object({ annotations: z.record(z.string(), z.string()) }),
      })
      .parse(
        findResource(rendered, "Job", "scout-activity-worker-retirement-gate"),
      );
    expect(gate.metadata.annotations?.["argocd.argoproj.io/sync-wave"]).toBe(
      "-1",
    );
    expect(gate.metadata.annotations?.["argocd.argoproj.io/hook"]).toBe("Sync");
  });

  test("an active worker requires a split gateway stage", () => {
    for (const topology of ["observing", "owning"] as const) {
      expect(() =>
        scoutResourcesWithActivityWorkerTopology("prod", "absent", topology),
      ).toThrow("requires a split gateway topology");
    }
  });
});
