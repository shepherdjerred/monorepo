import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import {
  findResource,
  scoutResources,
  temporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";
import { SCOUT_STAGES } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";
import { SCOUT_GATEWAY_OWNER_BY_STAGE } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/scout-alert-constants.ts";
import { scoutGatewayClientIngress } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";
import { SCOUT_CHILD_SYNC_TIMEOUT_FLOORS } from "@shepherdjerred/homelab/cdk8s/src/scout-release-budgets.ts";
import { createScoutBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/scout-beta.ts";
import { createScoutProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/scout-prod.ts";

const EnvEntrySchema = z
  .object({
    name: z.string(),
    value: z.string().optional(),
  })
  .loose();

const RoleDeploymentSchema = z.object({
  template: z.object({
    metadata: z.object({ labels: z.record(z.string(), z.string()) }),
    spec: z.object({
      securityContext: z.looseObject({
        seLinuxOptions: z.object({ level: z.string() }).optional(),
      }),
      containers: z.array(
        z.object({
          env: z.array(EnvEntrySchema),
          volumeMounts: z
            .array(
              z
                .object({
                  mountPath: z.string(),
                  name: z.string(),
                  readOnly: z.boolean().optional(),
                })
                .loose(),
            )
            .optional(),
        }),
      ),
      volumes: z
        .array(
          z
            .object({
              name: z.string(),
              persistentVolumeClaim: z
                .object({
                  claimName: z.string(),
                  readOnly: z.boolean().optional(),
                })
                .optional(),
            })
            .loose(),
        )
        .optional(),
    }),
  }),
});

const DuckDbRuntimeDeploymentSchema = z.object({
  template: z.object({
    spec: z.object({
      containers: z
        .array(
          z
            .object({
              env: z.array(EnvEntrySchema),
              resources: z
                .object({
                  requests: z.record(z.string(), z.string()).optional(),
                  limits: z.record(z.string(), z.string()).optional(),
                })
                .loose()
                .optional(),
              volumeMounts: z
                .array(z.looseObject({ mountPath: z.string() }))
                .optional(),
            })
            .loose(),
        )
        .nonempty(),
    }),
  }),
});

const NetworkPolicySpecSchema = z.object({
  podSelector: z.object({ matchLabels: z.record(z.string(), z.string()) }),
  policyTypes: z.array(z.string()),
});

function roleDeployment(stage: "beta" | "prod", name: string) {
  return RoleDeploymentSchema.parse(
    findResource(scoutResources(stage), "Deployment", name).spec,
  );
}

function envValue(
  deployment: z.infer<typeof RoleDeploymentSchema>,
  name: string,
): string | undefined {
  return deployment.template.spec.containers[0]?.env.find(
    (entry) => entry.name === name,
  )?.value;
}

describe("Scout runtime role assignment", () => {
  test.each(SCOUT_STAGES)(
    "shares the private support bucket across %s roles",
    (stage) => {
      for (const role of [
        "scout-backend",
        "scout-gateway",
        "scout-activity-worker",
      ]) {
        const deployment = roleDeployment(stage, `scout-${stage}-${role}`);
        expect(envValue(deployment, "SUPPORT_BUCKET_NAME")).toBe(
          `scout-support-${stage}`,
        );
      }
    },
  );
  test("a split stage's backend Deployment owns the application role", () => {
    const backend = RoleDeploymentSchema.parse(
      findResource(
        scoutResources("beta"),
        "Deployment",
        "scout-beta-scout-backend",
      ).spec,
    );
    expect(envValue(backend, "SCOUT_RUNTIME_ROLE")).toBe(
      "application-isolated",
    );
  });

  test("beta renders a gateway Deployment carrying the gateway role", () => {
    const gateway = roleDeployment("beta", "scout-beta-scout-gateway");
    expect(envValue(gateway, "SCOUT_RUNTIME_ROLE")).toBe("gateway");
    expect(gateway.template.metadata.labels).toEqual(
      expect.objectContaining({
        app: "scout-gateway",
        "scout-runtime-role": "gateway",
      }),
    );
  });

  test("prod splits its gateway and isolates application activities", () => {
    const backend = roleDeployment("prod", "scout-prod-scout-backend");
    expect(envValue(backend, "SCOUT_RUNTIME_ROLE")).toBe(
      "application-isolated",
    );

    const prod = scoutResources("prod");
    for (const [name, role] of [
      ["scout-gateway", "gateway"],
      ["scout-activity-worker", "activity-worker"],
    ] as const) {
      expect(
        envValue(
          roleDeployment("prod", `scout-prod-${name}`),
          "SCOUT_RUNTIME_ROLE",
        ),
      ).toBe(role);
      expect(
        prod.some(
          (resource) =>
            resource.kind === "Deployment" &&
            resource.metadata.name === `scout-prod-${name}`,
        ),
      ).toBe(true);
    }
  });

  test("the activity worker is present in both stages", () => {
    for (const stage of ["beta", "prod"] as const) {
      expect(
        scoutResources(stage).some(
          (resource) =>
            resource.kind === "Deployment" &&
            resource.metadata.name.includes("activity-worker"),
        ),
      ).toBe(true);
    }
  });
});

describe("Scout gateway report-lake sharing", () => {
  test("only prod expands its lake claim for the schema-change rebuild", () => {
    for (const [stage, storage] of [
      ["beta", "48Gi"],
      ["prod", "128Gi"],
    ] as const) {
      const claim = findResource(
        scoutResources(stage),
        "PersistentVolumeClaim",
        "scout-storage-claim",
      );
      expect(claim.spec).toEqual(
        expect.objectContaining({
          resources: { requests: { storage } },
        }),
      );
    }
  });

  /**
   * ReadWriteOnce is a per-node constraint, so the two pods sharing the claim
   * must be required — not merely preferred — onto one node.
   */
  test("gateway is required onto the application pod's node", () => {
    const AffinitySchema = z.object({
      template: z.object({
        spec: z.object({
          affinity: z.object({
            podAffinity: z.object({
              requiredDuringSchedulingIgnoredDuringExecution: z
                .array(z.looseObject({ topologyKey: z.string() }))
                .nonempty(),
            }),
          }),
        }),
      }),
    });
    const gateway = AffinitySchema.parse(
      findResource(
        scoutResources("beta"),
        "Deployment",
        "scout-beta-scout-gateway",
      ).spec,
    );
    expect(
      gateway.template.spec.affinity.podAffinity
        .requiredDuringSchedulingIgnoredDuringExecution,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topologyKey: "kubernetes.io/hostname" }),
      ]),
    );
  });

  /**
   * The gateway declares `reportLakeAccess` and does not fold, so its boot gate
   * refuses to start without a published lake. It therefore must mount the
   * volume — and must do so read-only, because the application role is the sole
   * publisher. The claim itself stays read-write: ZFS refuses a second mount of
   * the dataset with a different ro/rw flag, so read-only is enforced on the
   * container's volumeMount instead.
   */
  test("gateway mounts the application role's claim read-only", () => {
    const gateway = roleDeployment("beta", "scout-beta-scout-gateway");
    const backend = roleDeployment("beta", "scout-beta-scout-backend");

    const gatewayVolume = gateway.template.spec.volumes?.find(
      (volume) => volume.persistentVolumeClaim !== undefined,
    );
    const backendVolume = backend.template.spec.volumes?.find(
      (volume) => volume.persistentVolumeClaim !== undefined,
    );

    expect(gatewayVolume?.persistentVolumeClaim?.claimName).toBe(
      "scout-storage-claim",
    );
    expect(gatewayVolume?.persistentVolumeClaim?.claimName).toBe(
      backendVolume?.persistentVolumeClaim?.claimName,
    );
    // A read-only claim becomes an `ro` CSI mount, which ZFS rejects beside
    // the publisher's `rw` mount of the same dataset.
    expect(gatewayVolume?.persistentVolumeClaim?.readOnly).not.toBe(true);
    // The publisher keeps write access; only the reader is constrained.
    expect(backendVolume?.persistentVolumeClaim?.readOnly).not.toBe(true);

    const dataMount = gateway.template.spec.containers[0]?.volumeMounts?.find(
      (mount) => mount.mountPath === "/data",
    );
    expect(dataMount?.name).toBe(gatewayVolume?.name);
    expect(dataMount?.readOnly).toBe(true);
    expect(envValue(gateway, "REPORT_LAKE_DIR")).toBe("/data/report-lake");
  });

  /**
   * Both pods label the same files. A divergent MCS level would relabel the
   * lake out from under whichever pod started last.
   */
  test("gateway shares the backend's SELinux level", () => {
    const gateway = roleDeployment("beta", "scout-beta-scout-gateway");
    const backend = roleDeployment("beta", "scout-beta-scout-backend");
    const level = gateway.template.spec.securityContext.seLinuxOptions?.level;
    expect(level).toBe("s0:c220,c221");
    expect(level).toBe(
      backend.template.spec.securityContext.seLinuxOptions?.level,
    );
  });

  test("report query roles share scratch limits but reserve voice memory only in the gateway", () => {
    const app = DuckDbRuntimeDeploymentSchema.parse(
      findResource(
        scoutResources("beta"),
        "Deployment",
        "scout-beta-scout-backend",
      ).spec,
    );
    const gateway = DuckDbRuntimeDeploymentSchema.parse(
      findResource(
        scoutResources("beta"),
        "Deployment",
        "scout-beta-scout-gateway",
      ).spec,
    );
    const activityWorker = DuckDbRuntimeDeploymentSchema.parse(
      findResource(
        scoutResources("beta"),
        "Deployment",
        "scout-beta-scout-activity-worker",
      ).spec,
    );

    for (const deployment of [app, gateway, activityWorker]) {
      const container = deployment.template.spec.containers[0];
      expect(container?.env).toEqual(
        expect.arrayContaining([
          { name: "REPORT_DUCKDB_THREADS", value: "4" },
          { name: "REPORT_DUCKDB_MEMORY_LIMIT", value: "3GB" },
          { name: "REPORT_DUCKDB_TEMP_DIR", value: "/scratch/duckdb" },
          { name: "REPORT_DUCKDB_MAX_TEMP_SIZE", value: "7GiB" },
        ]),
      );
      expect(container?.volumeMounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ mountPath: "/scratch/duckdb" }),
        ]),
      );
    }

    expect(app.template.spec.containers[0]?.resources).toMatchObject({
      requests: { memory: "2048Mi" },
      limits: { memory: "8192Mi" },
    });
    expect(gateway.template.spec.containers[0]?.resources).toMatchObject({
      requests: { memory: "3072Mi" },
      limits: { memory: "8192Mi" },
    });
    expect(activityWorker.template.spec.containers[0]?.resources).toMatchObject(
      {
        requests: { memory: "2048Mi" },
        limits: { memory: "8192Mi" },
      },
    );
  });
});

describe("Scout gateway network boundary", () => {
  test("gateway is selected by a policy governing both directions", () => {
    const policy = NetworkPolicySpecSchema.parse(
      findResource(
        scoutResources("beta"),
        "NetworkPolicy",
        "scout-gateway-netpol",
      ).spec,
    );
    expect(policy.podSelector.matchLabels).toEqual({ app: "scout-gateway" });
    expect(policy.policyTypes).toEqual(
      expect.arrayContaining(["Ingress", "Egress"]),
    );
  });

  test("gateway egress admits DNS, Temporal, telemetry and external HTTPS", () => {
    const policy = findResource(
      scoutResources("beta"),
      "NetworkPolicy",
      "scout-gateway-netpol",
    );
    expect(policy.spec).toEqual(
      expect.objectContaining({
        egress: expect.arrayContaining([
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: { "kubernetes.io/metadata.name": "temporal" },
                },
                podSelector: { matchLabels: { app: "temporal-server" } },
              },
            ],
            ports: [{ port: 7233, protocol: "TCP" }],
          },
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "alloy-gateway",
                  },
                },
              },
            ],
            ports: [{ port: 4318, protocol: "TCP" }],
          },
          // Discord's gateway and REST, plus the model providers the in-process
          // Explore agent calls.
          {
            to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
            ports: [{ port: 443, protocol: "TCP" }],
          },
        ]),
      }),
    );
  });

  /**
   * The gateway serves `httpSurface: "admin"`, so unlike the application role
   * it must NOT be reachable from the public reverse proxy.
   */
  test("gateway ingress admits Prometheus only", () => {
    const policy = findResource(
      scoutResources("beta"),
      "NetworkPolicy",
      "scout-gateway-netpol",
    );
    expect(policy.spec).toEqual(
      expect.objectContaining({
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
      }),
    );
  });

  test("Temporal admits both hosted gateways", () => {
    const rules = scoutGatewayClientIngress();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.from).toEqual([
      {
        namespaceSelector: {
          matchLabels: { "kubernetes.io/metadata.name": "scout-beta" },
        },
        podSelector: { matchLabels: { app: "scout-gateway" } },
      },
      {
        namespaceSelector: {
          matchLabels: { "kubernetes.io/metadata.name": "scout-prod" },
        },
        podSelector: { matchLabels: { app: "scout-gateway" } },
      },
    ]);
  });

  /**
   * The complete set of Scout identities Temporal admits on gRPC.
   *
   * A NetworkPolicy is enforced at both ends, and the Temporal server's ingress
   * matches `app` exactly — the gateway's own egress rule is not enough, which
   * is why the split had to add an identity here at all. But an
   * `arrayContaining` check on just that addition would not notice one of the
   * OTHER identities disappearing, and the test that used to pin the backend
   * pair lived in scout-weekly-parlay-boundary.test.ts, which main deleted when
   * it retired the weekly parlay. So this asserts the exact set: a removed
   * identity fails just as loudly as an unexpected new one.
   */
  test("Temporal admits exactly the expected Scout identities on gRPC", () => {
    const IngressSchema = z.object({
      ingress: z.array(
        z.looseObject({
          from: z
            .array(
              z.looseObject({
                namespaceSelector: z
                  .looseObject({
                    matchLabels: z.record(z.string(), z.string()).optional(),
                  })
                  .optional(),
                podSelector: z
                  .looseObject({
                    matchLabels: z.record(z.string(), z.string()).optional(),
                  })
                  .optional(),
              }),
            )
            .optional(),
          ports: z
            .array(z.looseObject({ port: z.number(), protocol: z.string() }))
            .optional(),
        }),
      ),
    });
    const policy = IngressSchema.parse(
      findResource(
        temporalResources(),
        "NetworkPolicy",
        "temporal-server-netpol",
      ).spec,
    );

    const admitted = new Set<string>();
    for (const rule of policy.ingress) {
      if (!(rule.ports ?? []).some((port) => port.port === 7233)) continue;
      for (const peer of rule.from ?? []) {
        const namespace =
          peer.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"];
        if (!namespace?.startsWith("scout-")) continue;
        const selector = Object.entries(peer.podSelector?.matchLabels ?? {})
          .map(([key, value]) => `${key}=${value}`)
          .toSorted()
          .join(",");
        admitted.add(`${namespace}/${selector}`);
      }
    }

    expect([...admitted].toSorted()).toEqual([
      "scout-beta/app=scout-activity-worker",
      // The application role retains Workflow and interactive pollers, and
      // observes realtime, background, and competition queues in prod.
      "scout-beta/app=scout-backend",
      // The split gateway starts Workflows for Discord commands.
      "scout-beta/app=scout-gateway",
      "scout-beta/worker-family=scout-beta-workflows",
      "scout-prod/app=scout-activity-worker",
      "scout-prod/app=scout-backend",
      "scout-prod/app=scout-gateway",
      "scout-prod/worker-family=scout-prod-workflows",
    ]);
  });
});

describe("Scout gateway observability", () => {
  test("gateway is scraped under its own role-bearing selector", () => {
    const beta = scoutResources("beta");
    const service = findResource(beta, "Service", "scout-gateway-service-beta");
    expect(service.metadata).toEqual(
      expect.objectContaining({
        labels: { app: "scout-gateway", stage: "beta" },
      }),
    );

    const monitor = findResource(
      beta,
      "ServiceMonitor",
      "scout-gateway-beta-service-monitor",
    );
    expect(monitor.spec).toEqual(
      expect.objectContaining({
        selector: { matchLabels: { app: "scout-gateway", stage: "beta" } },
      }),
    );
  });

  /**
   * Every role serves the same admin surface on the same port, so the probe
   * paths are shared rather than role-specific.
   */
  test("admin probes and release waits cover both Scout applications", () => {
    const ProbeSchema = z.object({
      template: z.object({
        spec: z.object({
          containers: z.array(
            z
              .object({
                startupProbe: z.looseObject({
                  httpGet: z.object({ path: z.string(), port: z.number() }),
                  periodSeconds: z.number(),
                  failureThreshold: z.number(),
                }),
                livenessProbe: z.looseObject({
                  httpGet: z.object({ path: z.string(), port: z.number() }),
                }),
                readinessProbe: z.looseObject({
                  httpGet: z.object({ path: z.string(), port: z.number() }),
                }),
              })
              .loose(),
          ),
        }),
      }),
    });
    const gateway = ProbeSchema.parse(
      findResource(
        scoutResources("beta"),
        "Deployment",
        "scout-beta-scout-gateway",
      ).spec,
    );
    const container = gateway.template.spec.containers[0];
    expect(container?.startupProbe.httpGet).toEqual({
      path: "/ping",
      port: 3000,
    });
    expect(container).toBeDefined();
    if (container === undefined) throw new Error("gateway container missing");
    for (const [stage, createApplication] of [
      ["beta", createScoutBetaApp],
      ["prod", createScoutProdApp],
    ] as const) {
      const application = z
        .object({ metadata: z.object({ name: z.string() }) })
        .parse(
          createApplication(
            new Chart(new App(), `scout-${stage}-release-budget`),
          ).toJson(),
        );
      const backend = ProbeSchema.parse(
        findResource(
          scoutResources(stage),
          "Deployment",
          `${application.metadata.name}-scout-backend`,
        ).spec,
      );
      const probe = backend.template.spec.containers[0]?.startupProbe;
      if (probe === undefined) throw new Error("backend startup probe missing");
      expect(
        SCOUT_CHILD_SYNC_TIMEOUT_FLOORS.get(application.metadata.name),
      ).toBeGreaterThan(probe.periodSeconds * probe.failureThreshold);
    }
    expect(container?.livenessProbe.httpGet).toEqual({
      path: "/livez",
      port: 3000,
    });
    expect(container?.readinessProbe.httpGet).toEqual({
      path: "/healthz",
      port: 3000,
    });
  });
});

describe("Hosted Scout roles", () => {
  test.each(SCOUT_STAGES)(
    "keeps the declared gateway and activity worker replicas in %s",
    (stage) => {
      const resources = scoutResources(stage);
      for (const name of ["scout-gateway", "scout-activity-worker"]) {
        const resource = findResource(
          resources,
          "Deployment",
          `scout-${stage}-${name}`,
        );
        expect(
          z.object({ replicas: z.number() }).parse(resource.spec).replicas,
        ).toBe(1);
        expect(resource.metadata["annotations"]).toEqual(
          expect.objectContaining({ "argocd.argoproj.io/sync-wave": "1" }),
        );
      }
      expect(
        resources.some((resource) =>
          resource.metadata.name.includes("retirement"),
        ),
      ).toBe(false);
    },
  );
  test("Beta resumes all five application roles without changing the database or Prod", () => {
    const beta = scoutResources("beta");
    const deployments = beta.filter(
      (resource) => resource.kind === "Deployment",
    );
    expect(
      deployments.map((resource) => resource.metadata.name).sort(),
    ).toEqual([
      "scout-beta-scout-activity-worker",
      "scout-beta-scout-backend",
      "scout-beta-scout-gateway",
      "scout-beta-scout-workflow-worker-candidate",
      "scout-beta-scout-workflow-worker-stable",
    ]);
    for (const resource of deployments) {
      expect(
        z.object({ replicas: z.number() }).parse(resource.spec).replicas,
      ).toBe(1);
    }
    const database = findResource(beta, "postgresql", "scout-beta-postgresql");
    expect(
      z.object({ numberOfInstances: z.number() }).parse(database.spec)
        .numberOfInstances,
    ).toBe(1);
    const prod = scoutResources("prod").filter(
      (resource) => resource.kind === "Deployment",
    );
    expect(prod).toHaveLength(5);
    for (const resource of prod) {
      expect(
        z.object({ replicas: z.number() }).parse(resource.spec).replicas,
      ).toBe(1);
    }
  });
  test("monitoring names the deployed gateway owner", () => {
    expect(SCOUT_GATEWAY_OWNER_BY_STAGE).toEqual(
      SCOUT_STAGES.map((environment) => ({ environment, role: "gateway" })),
    );
  });
});
