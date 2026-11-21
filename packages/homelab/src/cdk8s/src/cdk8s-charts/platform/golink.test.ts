import { beforeEach, describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createGolinkChart } from "./golink.ts";
import { GOLINK_FIRST_PARTY_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/golink/index.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";
import { KUBERNETES_API_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

const image = `docker.io/shepherdjerred/golink@sha256:${"2".repeat(64)}`;

const ManifestSchema = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.unknown(),
});

const ContainerSchema = z.object({
  name: z.string(),
  image: z.string(),
  command: z.array(z.string()).optional(),
  env: ContainerEnvSchema,
  securityContext: z.unknown(),
});

beforeEach(resetProbeRegistry);

describe("createGolinkChart", () => {
  test("defaults to inactive in Stage 1 and preserves the upstream tailscale/golink deployment", () => {
    expect(GOLINK_FIRST_PARTY_ACTIVE).toBe(false);
    const defaultManifests = z
      .array(ManifestSchema)
      .parse(createGolinkChart(new App()).toJson());
    const explicitInactive = z
      .array(ManifestSchema)
      .parse(createGolinkChart(new App(), { active: false }).toJson());

    expect(defaultManifests).toEqual(explicitInactive);
    expect(defaultManifests.map((resource) => resource.kind)).toEqual([
      "Deployment",
      "PersistentVolumeClaim",
      "OnePasswordItem",
      "NetworkPolicy",
    ]);

    const deployment = defaultManifests.find(
      (resource) => resource.kind === "Deployment",
    );
    const spec = z
      .object({
        template: z.object({
          spec: z.object({
            containers: z.array(z.object({ image: z.string() })),
          }),
        }),
      })
      .parse(deployment?.spec);
    expect(spec.template.spec.containers[0]?.image).toMatch(
      /^ghcr\.io\/tailscale\/golink:/u,
    );
    expect(
      defaultManifests.find((resource) => resource.kind === "NetworkPolicy")
        ?.metadata.name,
    ).toBe("golink-netpol");
  });

  test("renders FirstPartyWebService, PostgreSQL, Deployment, Service, and tight NetworkPolicy when active", () => {
    const resources = z
      .array(ManifestSchema)
      .parse(createGolinkChart(new App(), { active: true, image }).toJson());

    expect(
      resources.find((resource) => resource.kind === "Namespace")?.metadata
        .name,
    ).toBe("golink");
    expect(
      resources.find((resource) => resource.kind === "Service")?.metadata.name,
    ).toBe("golink");
    expect(
      resources.find((resource) => resource.kind === "ServiceMonitor")?.metadata
        .name,
    ).toBe("golink-service-monitor");

    const database = resources.find(
      (resource) => resource.kind === "postgresql",
    );
    expect(database?.metadata.name).toBe("golink-postgresql");
    expect(database?.metadata.labels?.["velero.io/backup"]).toBe("enabled");
    expect(
      database?.metadata.annotations?.["argocd.argoproj.io/sync-options"],
    ).toBe("Delete=false");
    expect(database?.spec).toMatchObject({
      postgresql: { version: "18" },
      volume: { size: "32Gi" },
      databases: { golink_db: "golink" },
    });

    const deployment = resources.find(
      (resource) => resource.kind === "Deployment",
    );
    const spec = z
      .object({
        template: z.object({
          metadata: z.object({ labels: z.record(z.string(), z.string()) }),
          spec: z.object({
            containers: z.array(ContainerSchema),
            initContainers: z.array(ContainerSchema),
          }),
        }),
      })
      .parse(deployment?.spec);
    expect(spec.template.metadata.labels["app"]).toBe("golink");

    for (const item of [
      ...spec.template.spec.containers,
      ...spec.template.spec.initContainers,
    ]) {
      expect(item.image).toBe(image);
      expect(item.securityContext).toMatchObject({
        runAsNonRoot: true,
        runAsUser: 1000,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
      });
      const names = item.env.map((value) => value.name);
      expect(names.indexOf("DB_USER")).toBeLessThan(
        names.indexOf("DATABASE_URL"),
      );
      expect(names.indexOf("DB_PASSWORD")).toBeLessThan(
        names.indexOf("DATABASE_URL"),
      );
      for (const value of item.env) {
        if (value.valueFrom !== undefined) {
          expect(value.valueFrom.secretKeyRef.optional).not.toBe(true);
        }
      }
    }

    expect(spec.template.spec.initContainers[0]?.command).toEqual([
      "bunx",
      "--no-install",
      "prisma",
      "migrate",
      "deploy",
    ]);
    expect(spec.template.spec.containers[0]?.command).toEqual([
      "bun",
      "src/server/index.ts",
    ]);

    const policy = resources.find(
      (resource) => resource.kind === "NetworkPolicy",
    );
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
      .parse(policy?.spec);
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
