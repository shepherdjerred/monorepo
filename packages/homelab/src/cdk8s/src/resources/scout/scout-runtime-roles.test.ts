import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResources,
  temporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";
import {
  assertStageCanHostSplitRoles,
  SPLIT_TOPOLOGY_STAGES,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/gateway.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

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
              z.object({ mountPath: z.string(), name: z.string() }).loose(),
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
  test("beta's backend Deployment owns the application role", () => {
    const backend = roleDeployment("beta", "scout-beta-scout-backend");
    expect(envValue(backend, "SCOUT_RUNTIME_ROLE")).toBe("application");
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

  /**
   * The rollback floor. Prod must keep running the combined role, and an unset
   * SCOUT_RUNTIME_ROLE is what `parseScoutRuntimeRole` resolves to `combined` —
   * so the absence asserted here is the behaviour, not an omission.
   */
  test("prod stays combined and renders no split-role workload", () => {
    const backend = roleDeployment("prod", "scout-prod-scout-backend");
    expect(envValue(backend, "SCOUT_RUNTIME_ROLE")).toBeUndefined();

    const prod = scoutResources("prod");
    expect(
      prod.filter(
        (resource) =>
          resource.kind === "Deployment" &&
          (resource.metadata.name.includes("gateway") ||
            resource.metadata.name.includes("activity-worker")),
      ),
    ).toEqual([]);
  });

  /**
   * `activity-worker` reads the lake AND writes its ingest staging directories,
   * so it cannot share the ReadWriteOnce claim with the publishing role. It is
   * deliberately absent until the lake is shareable; this asserts the deferral
   * rather than leaving its absence to chance.
   */
  test("no activity-worker Deployment is rendered in either stage", () => {
    for (const stage of ["beta", "prod"] as const) {
      expect(
        scoutResources(stage).some((resource) =>
          resource.metadata.name.includes("activity-worker"),
        ),
      ).toBe(false);
    }
  });
});

describe("Scout split-topology opt-in", () => {
  test("only beta is opted into the split today", () => {
    expect([...SPLIT_TOPOLOGY_STAGES]).toEqual(["beta"]);
  });

  /**
   * The predicate gates the human decision rather than making it, so it has to
   * hold for every stage already on the list.
   */
  test("every opted-in stage's pinned image is on the PostgreSQL contract", () => {
    for (const stage of SPLIT_TOPOLOGY_STAGES) {
      expect(() => {
        assertStageCanHostSplitRoles(
          stage,
          versions[`shepherdjerred/scout-for-lol/${stage}`],
        );
      }).not.toThrow();
    }
  });

  /**
   * The other direction: opting in a stage whose image still keeps its database
   * on the shared claim must fail synth, and must say why rather than failing
   * obscurely.
   *
   * The fixture is a synthetic digest rather than a real pin on purpose. An
   * earlier version of this test used prod's live pin as the SQLite example,
   * which stopped being one the moment prod was promoted onto the PostgreSQL
   * contract — a test that silently inverts when an unrelated Renovate bump
   * lands is worse than no test. Any digest absent from the catalog's contract
   * set exercises the same branch, permanently.
   */
  test("opting in a SQLite-pinned stage fails synth and names the hazard", () => {
    const unlistedDigestPin = `2.0.0-1@sha256:${"0".repeat(64)}`;
    expect(() => {
      assertStageCanHostSplitRoles("prod", unlistedDigestPin);
    }).toThrow(/SQLite/);
    expect(() => {
      assertStageCanHostSplitRoles("prod", unlistedDigestPin);
    }).toThrow(/same SQLite database file open/);
  });
});

describe("Scout gateway report-lake sharing", () => {
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
   * publisher.
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
    expect(gatewayVolume?.persistentVolumeClaim?.readOnly).toBe(true);
    // The publisher keeps write access; only the reader is constrained.
    expect(backendVolume?.persistentVolumeClaim?.readOnly).not.toBe(true);

    expect(gateway.template.spec.containers[0]?.volumeMounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ mountPath: "/data" })]),
    );
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

  /**
   * A NetworkPolicy is enforced at both ends. The gateway's own egress rule is
   * not enough — the Temporal server's ingress matches `app` exactly, and the
   * split gave this role a new one.
   */
  test("Temporal admits the gateway identity on gRPC", () => {
    expect(
      findResource(
        temporalResources(),
        "NetworkPolicy",
        "temporal-server-netpol",
      ).spec,
    ).toEqual(
      expect.objectContaining({
        ingress: expect.arrayContaining([
          {
            from: [
              {
                namespaceSelector: {
                  matchLabels: { "kubernetes.io/metadata.name": "scout-beta" },
                },
                podSelector: { matchLabels: { app: "scout-gateway" } },
              },
            ],
            ports: [{ port: 7233, protocol: "TCP" }],
          },
        ]),
      }),
    );
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
  test("gateway probes the admin HTTP surface", () => {
    const ProbeSchema = z.object({
      template: z.object({
        spec: z.object({
          containers: z.array(
            z
              .object({
                startupProbe: z.looseObject({
                  httpGet: z.object({ path: z.string(), port: z.number() }),
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
