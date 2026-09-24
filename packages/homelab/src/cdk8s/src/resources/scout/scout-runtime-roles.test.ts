import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResources,
  scoutResourcesWithGatewayTopology,
  temporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";
import {
  gatewayTopologyRunsRole,
  SCOUT_GATEWAY_TOPOLOGY,
  SCOUT_STAGES,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";
import { SCOUT_GATEWAY_OWNER_BY_STAGE } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/scout-alert-constants.ts";

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
  test("a split stage's backend Deployment owns the application role", () => {
    const backend = RoleDeploymentSchema.parse(
      findResource(
        scoutResourcesWithGatewayTopology("beta", "split"),
        "Deployment",
        "scout-beta-scout-backend",
      ).spec,
    );
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
  test("beta is retiring the split and prod never ran it", () => {
    expect(SCOUT_GATEWAY_TOPOLOGY).toEqual({
      beta: "retiring",
      prod: "absent",
    });
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
      // The application role (and, on an unsplit stage, the combined pod):
      // embedded workers plus the competition activity dispatcher.
      "scout-beta/app=scout-backend",
      // The gateway role's Temporal client. It runs no Activity worker, but
      // Discord commands start Workflows they do not execute, so a blocked
      // client here is every slash command failing to dispatch.
      "scout-beta/app=scout-gateway",
      "scout-beta/worker-family=scout-beta-workflows",
      "scout-prod/app=scout-backend",
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

/**
 * The rollback the `retiring` topology exists for.
 *
 * The gateway pod holds the Discord token, and a rolled-back backend returning
 * to `combined` would open a second session on the same token if that pod were
 * still running. Simply un-rendering the gateway would leave its deletion (by
 * a pruning release sync) ordered after the wave-0 backend, or not happen at
 * all (a sync without prune). Retirement therefore has to be a rendered,
 * ordered state, and these assertions are what keep it one. The termination
 * gate between the two waves is covered in
 * `scout-gateway-retirement-gate.test.ts`.
 *
 * Every case renders the real chart through the documented topology override
 * rather than mocking the module that decides the topology: a mocked decision
 * would only prove the mock.
 */
const AnnotatedDeploymentSchema = z.object({
  metadata: z.looseObject({
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.looseObject({ replicas: z.number().optional() }),
});

function retiringBeta() {
  return scoutResourcesWithGatewayTopology("beta", "retiring");
}

function annotatedDeployment(
  resources: ReturnType<typeof retiringBeta>,
  name: string,
) {
  return AnnotatedDeploymentSchema.parse(
    findResource(resources, "Deployment", name),
  );
}

function syncWave(
  deployment: z.infer<typeof AnnotatedDeploymentSchema>,
): number {
  // An unannotated resource is in ArgoCD's default wave 0 — which is exactly
  // where the backend sits, and the reason the gateway's wave is meaningful.
  return Number(
    deployment.metadata.annotations?.["argocd.argoproj.io/sync-wave"] ?? "0",
  );
}

describe("Scout gateway retirement", () => {
  /**
   * The whole point: the retirement sync scales the shard's pod away by
   * itself. If this Deployment ever stops being rendered instead, the pod is
   * deleted too late or not at all and keeps holding the token.
   */
  test("retiring renders the gateway Deployment at zero replicas", () => {
    const gateway = annotatedDeployment(
      retiringBeta(),
      "scout-beta-scout-gateway",
    );
    expect(gateway.spec.replicas).toBe(0);
  });

  /**
   * The ordering, and the reason this is not simply "render it at zero".
   *
   * The backend carries no sync-wave annotation, so it is in the default wave
   * 0, and its Recreate rollout back to `combined` is what re-opens a Discord
   * session. The gateway's scale-to-zero has to be applied BEFORE that.
   * Asserting the relation rather than the literal annotation so the claim is
   * the ordering itself: an edit that moved the backend into a wave would have
   * to come back here.
   */
  test("retiring orders the scale-to-zero strictly before the backend", () => {
    const resources = retiringBeta();
    expect(
      syncWave(annotatedDeployment(resources, "scout-beta-scout-gateway")),
    ).toBeLessThan(
      syncWave(annotatedDeployment(resources, "scout-beta-scout-backend")),
    );
  });

  /**
   * The forward direction must not be "fixed" to match. Splitting requires the
   * opposite order — the backend's wave-0 handover is a precondition of the
   * gateway pod existing at all — so one wave cannot serve both directions.
   */
  test("splitting still orders the gateway strictly after the backend", () => {
    const resources = scoutResourcesWithGatewayTopology("beta", "split");
    const gateway = annotatedDeployment(resources, "scout-beta-scout-gateway");
    expect(gateway.spec.replicas).toBe(1);
    expect(syncWave(gateway)).toBeGreaterThan(
      syncWave(annotatedDeployment(resources, "scout-beta-scout-backend")),
    );
  });

  /**
   * The other half of the rollback: the shard comes home. An unset
   * SCOUT_RUNTIME_ROLE is what the backend resolves to `combined`, so the
   * absence asserted here is the behaviour rather than an omission.
   */
  test("retiring returns the backend to the combined role", () => {
    const backend = RoleDeploymentSchema.parse(
      findResource(retiringBeta(), "Deployment", "scout-beta-scout-backend")
        .spec,
    );
    expect(envValue(backend, "SCOUT_RUNTIME_ROLE")).toBeUndefined();
  });

  /**
   * Voice follows the shard in both directions. A rollback that took the shard
   * back but left voice on the retired pod would leave `/scout join` wired to a
   * pod that no longer exists.
   */
  test("retiring brings voice back to the combined pod", () => {
    const resources = retiringBeta();
    const backend = RoleDeploymentSchema.parse(
      findResource(resources, "Deployment", "scout-beta-scout-backend").spec,
    );
    expect(envValue(backend, "VOICE_OPENAI_API_KEY_FILE")).toBe(
      "/run/secrets/scout-openai/OPENAI_API_KEY",
    );
    expect(
      backend.template.spec.containers[0]?.volumeMounts?.some(
        (mount) => mount.mountPath === "/run/secrets/scout-openai",
      ),
    ).toBe(true);

    // A blocked media path is invisible — the voice websocket rides TCP/443 and
    // connects fine — so assert the UDP rule came back with the credential
    // rather than only the credential.
    const policy = findResource(
      resources,
      "NetworkPolicy",
      "scout-egress-netpol",
    );
    expect(
      z.object({ egress: z.array(z.unknown()) }).parse(policy.spec).egress,
    ).toEqual(
      expect.arrayContaining([
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: 50_000, endPort: 65_535, protocol: "UDP" }],
        },
      ]),
    );
  });

  /**
   * The stage stays fully managed while retiring. These select nothing once the
   * pod is gone, but a resource that stops being rendered under a non-pruning
   * Application is exactly the half-orphaned state this change exists to stop
   * creating. They are deleted with the Deployment when the stage goes absent.
   */
  test("retiring keeps the gateway's Service, monitor and policy rendered", () => {
    const resources = retiringBeta();
    for (const [kind, name] of [
      ["Service", "scout-gateway-service-beta"],
      ["ServiceMonitor", "scout-gateway-beta-service-monitor"],
      ["NetworkPolicy", "scout-gateway-netpol"],
    ] as const) {
      expect(findResource(resources, kind, name).metadata.name).toBe(name);
    }
  });

  /**
   * The third arm of the tri-state, asserted for beta rather than inferred from
   * prod. `absent` is the later cleanup change, and it has to remove the whole
   * set rather than only the Deployment.
   */
  test("absent renders no gateway resource of any kind", () => {
    expect(
      scoutResourcesWithGatewayTopology("beta", "absent").filter((resource) =>
        resource.metadata.name.includes("gateway"),
      ),
    ).toEqual([]);
  });
});

/**
 * The disconnect alert has to follow the topology, not shadow it.
 *
 * `ScoutDiscordDisconnected` guards its gauge with `absent()`, so a stage whose
 * owner table names a role that has no pod does not degrade — it pages
 * critical, continuously, while perfectly healthy, and does not clear. Before
 * this became a derivation the owner table and the topology table were two
 * hand-maintained lists of the same fact with nothing coupling them, so
 * retiring beta's gateway while the alert still said `gateway` was one edit
 * away in the rollback direction.
 */
describe("Scout gateway owner table", () => {
  test("names gateway for exactly the stages running the split", () => {
    expect(SCOUT_GATEWAY_OWNER_BY_STAGE).not.toEqual([]);
    for (const { environment, role } of SCOUT_GATEWAY_OWNER_BY_STAGE) {
      expect(role === "gateway").toBe(
        gatewayTopologyRunsRole(SCOUT_GATEWAY_TOPOLOGY[environment]),
      );
    }
  });

  test("covers every stage exactly once", () => {
    expect(
      SCOUT_GATEWAY_OWNER_BY_STAGE.map((entry) => entry.environment).toSorted(),
    ).toEqual([...SCOUT_STAGES].toSorted());
  });

  /**
   * A retiring stage has already handed the shard back, so its gateway series
   * is the one that stops existing. `combined` is the only answer that keeps
   * the alert pointed at a pod that exists.
   */
  test("a stage that does not run the split is owned by combined", () => {
    expect(gatewayTopologyRunsRole("retiring")).toBe(false);
    expect(gatewayTopologyRunsRole("absent")).toBe(false);
    expect(gatewayTopologyRunsRole("split")).toBe(true);
  });
});
