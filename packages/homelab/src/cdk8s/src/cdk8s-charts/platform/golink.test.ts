import { beforeEach, describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createGolinkChart } from "./golink.ts";
import { GOLINK_FIRST_PARTY_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/golink/index.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";
import { podTemplateSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/pod-template-schema.ts";
import { synthManifests } from "@shepherdjerred/homelab/cdk8s/src/testing/synth-manifests.ts";
import { KUBERNETES_API_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

const PINNED_GOLINK_IMAGE = `docker.io/shepherdjerred/golink@sha256:${"2".repeat(64)}`;

const GolinkContainerSchema = z.object({
  name: z.string(),
  image: z.string(),
  command: z.array(z.string()).optional(),
  env: ContainerEnvSchema,
  securityContext: z.unknown(),
});

const GolinkDeploymentSpecSchema = z.object({
  template: podTemplateSchema(GolinkContainerSchema).extend({
    spec: z.object({
      containers: z.array(GolinkContainerSchema),
      initContainers: z.array(GolinkContainerSchema),
    }),
  }),
});

function assertGolinkContainerContract(
  container: z.infer<typeof GolinkContainerSchema>,
): void {
  expect(container.image).toBe(PINNED_GOLINK_IMAGE);
  expect(container.securityContext).toMatchObject({
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
    runAsUser: 1000,
  });
  const envNames = container.env.map((entry) => entry.name);
  const dbUrlPos = envNames.indexOf("DATABASE_URL");
  expect(dbUrlPos).toBeGreaterThan(envNames.indexOf("DB_USER"));
  expect(dbUrlPos).toBeGreaterThan(envNames.indexOf("DB_PASSWORD"));
  for (const entry of container.env) {
    expect(entry.valueFrom?.secretKeyRef.optional).not.toBe(true);
  }
}

beforeEach(resetProbeRegistry);

describe("createGolinkChart", () => {
  test("defaults to inactive in Stage 1 and preserves the upstream tailscale/golink deployment", () => {
    expect(GOLINK_FIRST_PARTY_ACTIVE).toBe(false);
    const defaultChart = synthManifests(createGolinkChart(new App()));
    const explicitInactive = synthManifests(
      createGolinkChart(new App(), { active: false }),
    );

    expect(defaultChart.manifests).toEqual(explicitInactive.manifests);
    expect(defaultChart.identities).toEqual([
      "Deployment/golink",
      "PersistentVolumeClaim/golink-pvc",
      "OnePasswordItem/tailscale-auth-key",
      "NetworkPolicy/golink-netpol",
    ]);

    const upstreamDeployment = defaultChart.of("Deployment")[0];
    const upstreamSpec = z
      .object({
        template: z.object({
          spec: z.object({
            containers: z.array(z.object({ image: z.string() })),
          }),
        }),
      })
      .parse(upstreamDeployment?.["spec"]);
    expect(upstreamSpec.template.spec.containers[0]?.image).toMatch(
      /^ghcr\.io\/tailscale\/golink:/u,
    );
  });

  test("renders FirstPartyWebService, PostgreSQL, Deployment, Service, and tight NetworkPolicy when active", () => {
    const rendered = synthManifests(
      createGolinkChart(new App(), {
        active: true,
        image: PINNED_GOLINK_IMAGE,
      }),
    );

    expect(rendered.identities).toContain("Namespace/golink");
    expect(rendered.identities).toContain("Service/golink");
    expect(rendered.identities).toContain(
      "ServiceMonitor/golink-service-monitor",
    );

    const database = z
      .object({
        metadata: z.object({
          name: z.string(),
          labels: z.record(z.string(), z.string()),
          annotations: z.record(z.string(), z.string()),
        }),
        spec: z.unknown(),
      })
      .parse(rendered.of("postgresql")[0]);
    expect(database.metadata).toMatchObject({
      name: "golink-postgresql",
      labels: { "velero.io/backup": "enabled" },
      annotations: { "argocd.argoproj.io/sync-options": "Delete=false" },
    });
    expect(database.spec).toMatchObject({
      databases: { golink_db: "golink" },
      postgresql: { version: "18" },
      volume: { size: "32Gi" },
    });

    const deploymentSpec = GolinkDeploymentSpecSchema.parse(
      rendered.of("Deployment")[0]?.["spec"],
    );
    expect(deploymentSpec.template.metadata.labels).toMatchObject({
      app: "golink",
    });

    const allContainers = [
      ...deploymentSpec.template.spec.initContainers,
      ...deploymentSpec.template.spec.containers,
    ];
    expect(allContainers).toHaveLength(2);
    for (const container of allContainers) {
      assertGolinkContainerContract(container);
    }

    expect(deploymentSpec.template.spec.initContainers[0]?.command).toEqual([
      "bunx",
      "--no-install",
      "prisma",
      "migrate",
      "deploy",
    ]);
    expect(deploymentSpec.template.spec.containers[0]?.command).toEqual([
      "bun",
      "src/server/index.ts",
    ]);

    const policy = rendered.of("NetworkPolicy")[0];
    expect(policy?.metadata.name).toBe("golink-app-netpol");
    const policySpec = z
      .object({
        podSelector: z.object({
          matchLabels: z.record(z.string(), z.string()),
        }),
        ingress: z.array(
          z.object({
            from: z.array(z.unknown()),
            ports: z.array(
              z.object({ port: z.number(), protocol: z.string() }),
            ),
          }),
        ),
        egress: z.array(z.unknown()),
      })
      .parse(policy?.["spec"]);
    expect(policySpec.podSelector.matchLabels).toEqual({ app: "golink" });
    expect(policySpec.ingress).toEqual([
      {
        from: [
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
            },
          },
        ],
        ports: [{ port: 7352, protocol: "TCP" }],
      },
    ]);
    expect(policySpec.egress).toHaveLength(5);
    expect(JSON.stringify(policySpec.egress)).toContain(
      KUBERNETES_API_ENDPOINT.cidr,
    );
  });

  test("rejects an unpinned mutable image when active", () => {
    expect(() =>
      createGolinkChart(new App(), {
        active: true,
        image: "docker.io/shepherdjerred/golink:latest",
      }),
    ).toThrow("pinned public image digest");
  });
});
