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
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";

const PINNED_GOLINK_IMAGE = `docker.io/shepherdjerred/golink@sha256:${"2".repeat(64)}`;

const GolinkContainerSchema = z.object({
  name: z.string(),
  image: z.string(),
  command: z.array(z.string()).optional(),
  env: ContainerEnvSchema,
  securityContext: z.unknown(),
  volumeMounts: z
    .array(
      z.object({ mountPath: z.string(), readOnly: z.boolean().optional() }),
    )
    .optional(),
});

const GolinkDeploymentSpecSchema = z.object({
  strategy: z.object({ type: z.string() }),
  template: podTemplateSchema(GolinkContainerSchema).extend({
    spec: z.object({
      serviceAccountName: z.string(),
      automountServiceAccountToken: z.boolean().optional(),
      containers: z.array(GolinkContainerSchema),
      initContainers: z.array(GolinkContainerSchema),
    }),
  }),
});

function assertRestrictedContainer(
  container: z.infer<typeof GolinkContainerSchema>,
): void {
  expect(container.securityContext).toMatchObject({
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
    runAsUser: 1000,
  });
  for (const entry of container.env) {
    expect(entry.valueFrom?.secretKeyRef.optional).not.toBe(true);
  }
}

function assertDatabaseEnvOrdering(
  container: z.infer<typeof GolinkContainerSchema>,
): void {
  const envNames = container.env.map((entry) => entry.name);
  const dbUrlPos = envNames.indexOf("DATABASE_URL");
  expect(dbUrlPos).toBeGreaterThan(envNames.indexOf("DB_USER"));
  expect(dbUrlPos).toBeGreaterThan(envNames.indexOf("DB_PASSWORD"));
}

beforeEach(resetProbeRegistry);

describe("createGolinkChart", () => {
  test("renders FirstPartyWebService, PostgreSQL, Tailscale handover + sidecar, RBAC, and NetworkPolicies", () => {
    expect(GOLINK_FIRST_PARTY_ACTIVE).toBe(true);
    const rendered = synthManifests(
      createGolinkChart(new App(), { image: PINNED_GOLINK_IMAGE }),
    );

    expect(rendered.identities).toEqual(
      expect.arrayContaining([
        "Namespace/golink",
        "ServiceAccount/golink",
        "Role/golink-tailscale-state",
        "RoleBinding/golink-tailscale-state",
        "ClusterRole/golink-discovery-reader",
        "ClusterRoleBinding/golink-discovery-reader",
        "ConfigMap/golink-tailscale-serve",
        "OnePasswordItem/tailscale-auth-key",
        "Service/golink",
        "ServiceMonitor/golink-service-monitor",
        "NetworkPolicy/golink-netpol",
        "NetworkPolicy/golink-postgresql-netpol",
      ]),
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
      volume: { size: "32Gi", storageClass: "zfs-ssd-lz4" },
    });

    const deploymentSpec = GolinkDeploymentSpecSchema.parse(
      rendered.of("Deployment")[0]?.["spec"],
    );
    expect(deploymentSpec.strategy.type).toBe("Recreate");
    expect(deploymentSpec.template.metadata.labels).toMatchObject({
      app: "golink",
    });
    expect(deploymentSpec.template.spec.serviceAccountName).toBe("golink");
    expect(deploymentSpec.template.spec.automountServiceAccountToken).toBe(
      true,
    );

    const [migrateContainer, handoverContainer] =
      deploymentSpec.template.spec.initContainers;
    const [serverContainer, tailscaleContainer] =
      deploymentSpec.template.spec.containers;
    if (
      migrateContainer === undefined ||
      handoverContainer === undefined ||
      serverContainer === undefined ||
      tailscaleContainer === undefined
    ) {
      throw new Error(
        "Expected migrate, tailscale-handover, golink, and tailscale containers",
      );
    }

    for (const container of [
      migrateContainer,
      handoverContainer,
      serverContainer,
      tailscaleContainer,
    ]) {
      assertRestrictedContainer(container);
    }
    for (const appContainer of [migrateContainer, serverContainer]) {
      expect(appContainer.image).toBe(PINNED_GOLINK_IMAGE);
      assertDatabaseEnvOrdering(appContainer);
    }

    expect(migrateContainer.command).toEqual([
      "bunx",
      "--no-install",
      "prisma",
      "migrate",
      "deploy",
    ]);
    expect(handoverContainer.name).toBe("tailscale-handover");
    expect(handoverContainer.image).toBe(PINNED_GOLINK_IMAGE);
    expect(handoverContainer.command).toEqual([
      "bun",
      "src/server/handover-tailscale.ts",
    ]);
    expect(handoverContainer.env).toEqual(
      expect.arrayContaining([
        { name: "TS_STATE_SECRET_NAME", value: "golink-tailscale-state" },
        { name: "TS_EXPECTED_HOSTNAME", value: "go" },
        { name: "TS_EXPECTED_FQDN", value: "go.tailnet-1a49.ts.net" },
        {
          name: "TS_OAUTH_CLIENT_ID",
          valueFrom: {
            secretKeyRef: { name: "tailscale-auth-key", key: "client_id" },
          },
        },
        {
          name: "TS_OAUTH_CLIENT_SECRET",
          valueFrom: {
            secretKeyRef: { name: "tailscale-auth-key", key: "client_secret" },
          },
        },
      ]),
    );

    expect(serverContainer.command).toEqual(["bun", "src/server/index.ts"]);
    expect(serverContainer.env).toContainEqual(
      expect.objectContaining({ name: "GOLINK_SEED_JSON" }),
    );

    expect(tailscaleContainer.name).toBe("tailscale");
    expect(tailscaleContainer.image).toMatch(
      /^ghcr\.io\/tailscale\/tailscale:/u,
    );
    expect(tailscaleContainer.env).toEqual(
      expect.arrayContaining([
        { name: "TS_USERSPACE", value: "true" },
        { name: "TS_AUTH_ONCE", value: "true" },
        { name: "TS_HOSTNAME", value: "go" },
        { name: "TS_KUBE_SECRET", value: "golink-tailscale-state" },
        { name: "TS_SERVE_CONFIG", value: "/etc/tailscale/serve.json" },
        { name: "TS_ADVERTISE_TAGS", value: "tag:k8s" },
        { name: "TS_EXTRA_ARGS", value: "--advertise-tags=tag:k8s" },
        {
          name: "TS_AUTHKEY",
          value: [
            "$(TS_OAUTH_CLIENT_",
            "SECRET)",
            "?ephemeral=false&preauthorized=true",
          ].join(""),
        },
      ]),
    );
    const tsEnvNames = tailscaleContainer.env.map((entry) => entry.name);
    expect(tsEnvNames.indexOf("TS_AUTHKEY")).toBeGreaterThan(
      tsEnvNames.indexOf("TS_OAUTH_CLIENT_SECRET"),
    );
    expect(tailscaleContainer.volumeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mountPath: "/tmp" }),
        expect.objectContaining({
          mountPath: "/etc/tailscale",
          readOnly: true,
        }),
      ]),
    );

    const serveConfig = z
      .object({ data: z.object({ "serve.json": z.string() }) })
      .parse(rendered.of("ConfigMap")[0]);
    expect(JSON.parse(serveConfig.data["serve.json"])).toEqual({
      TCP: {
        "80": { HTTP: true },
        "443": { HTTPS: true },
      },
      Web: {
        "${TS_CERT_DOMAIN}:80": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:7352" } },
        },
        "${TS_CERT_DOMAIN}:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:7352" } },
        },
      },
    });
  });
});

describe("createGolinkChart policies and validation", () => {
  test("migrates legacy golink-netpol in place and renders golink-postgresql-netpol", () => {
    const rendered = synthManifests(
      createGolinkChart(new App(), { image: PINNED_GOLINK_IMAGE }),
    );

    const appPolicy = rendered
      .of("NetworkPolicy")
      .find((candidate) => candidate.metadata.name === "golink-netpol");
    expect(appPolicy).toBeDefined();
    expect(appPolicy?.["spec"]).toMatchObject({
      podSelector: { matchLabels: { app: "golink" } },
      ingress: expect.arrayContaining([
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "temporal" },
              },
              podSelector: { matchLabels: { component: "infra-worker" } },
            },
          ],
          ports: [{ port: 7352, protocol: "TCP" }],
        },
      ]),
    });
    expect(JSON.stringify(appPolicy?.["spec"])).toContain(
      KUBERNETES_API_ENDPOINT.cidr,
    );

    const dbPolicy = rendered
      .of("NetworkPolicy")
      .find(
        (candidate) => candidate.metadata.name === "golink-postgresql-netpol",
      );
    expect(dbPolicy).toBeDefined();
    expect(dbPolicy?.["spec"]).toMatchObject({
      podSelector: {
        matchLabels: postgresClusterPodLabels("golink-postgresql"),
      },
      policyTypes: ["Ingress"],
    });
  });

  test("rejects an unpinned mutable image", () => {
    expect(() =>
      createGolinkChart(new App(), {
        image: "docker.io/shepherdjerred/golink:latest",
      }),
    ).toThrow("pinned public image digest");
  });
});
