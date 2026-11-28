import { beforeEach, describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createFeedsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/feeds.ts";
import { buildPostgresUrlExpr } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { FEEDS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/feeds/index.ts";

const K8sManifestHeaderSchema = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
});

const ContainerSchema = z.looseObject({
  name: z.string(),
  command: z.array(z.string()).optional(),
  env: z.array(
    z.looseObject({
      name: z.string(),
      value: z.string().optional(),
      valueFrom: z
        .looseObject({
          secretKeyRef: z.looseObject({ name: z.string() }).optional(),
        })
        .optional(),
    }),
  ),
});

const DeploymentSchema = z.looseObject({
  spec: z.looseObject({
    template: z.looseObject({
      spec: z.looseObject({
        initContainers: z.array(ContainerSchema),
        containers: z.array(ContainerSchema),
      }),
    }),
  }),
});

beforeEach(resetProbeRegistry);

describe("feeds cdk8s chart", () => {
  test("is active by default and renders console + public reader services, tunnel binding, PVC, and network policy", () => {
    expect(FEEDS_ACTIVE).toBe(true);
    const summaries = z
      .array(K8sManifestHeaderSchema)
      .parse(createFeedsChart(new App()).toJson())
      .map((obj) => `${obj.kind}/${obj.metadata.name}`);

    expect(summaries).toEqual(
      expect.arrayContaining([
        "Namespace/feeds",
        "Service/feeds",
        "Service/feeds-reader-service",
        "OnePasswordItem/feeds-auth",
        "PersistentVolumeClaim/feeds-data",
        "NetworkPolicy/feeds-app-netpol",
      ]),
    );
    expect(summaries.some((entry) => entry.startsWith("Deployment/"))).toBe(
      true,
    );
    expect(summaries.some((entry) => entry.startsWith("Ingress/"))).toBe(true);
    expect(summaries.some((entry) => entry.startsWith("TunnelBinding/"))).toBe(
      true,
    );
  });

  test("provisions feeds-postgresql, migrates it before the server, and lets only Feeds reach it", () => {
    const manifests = z
      .array(K8sManifestHeaderSchema)
      .parse(createFeedsChart(new App()).toJson());
    const summaries = manifests.map(
      (obj) => `${obj.kind}/${obj.metadata.name}`,
    );
    expect(summaries).toEqual(
      expect.arrayContaining([
        "postgresql/feeds-postgresql",
        "NetworkPolicy/feeds-pg-netpol",
        // The SQLite volume stays until the cutover has been verified.
        "PersistentVolumeClaim/feeds-data",
      ]),
    );

    const deployment = DeploymentSchema.parse(
      manifests.find((obj) => obj.kind === "Deployment"),
    );
    const pod = deployment.spec.template.spec;
    expect(pod.initContainers.map((container) => container.name)).toEqual([
      "prisma-migrate",
    ]);
    expect(pod.initContainers[0]?.command).toEqual([
      "bunx",
      "--no-install",
      "prisma",
      "migrate",
      "deploy",
    ]);
    const credentials =
      "feeds.feeds-postgresql.credentials.postgresql.acid.zalan.do";
    for (const container of [...pod.initContainers, ...pod.containers]) {
      const names = container.env.map((entry) => entry.name);
      // kubelet expands `$(DB_USER)` only from variables declared earlier.
      expect(names.indexOf("DB_USER")).toBeGreaterThanOrEqual(0);
      expect(names.indexOf("DB_PASSWORD")).toBeLessThan(
        names.indexOf("DATABASE_URL"),
      );
      expect(
        container.env.find((entry) => entry.name === "DATABASE_URL")?.value,
      ).toBe(buildPostgresUrlExpr("feeds-postgresql:5432", "feeds_db"));
      for (const key of ["DB_USER", "DB_PASSWORD"]) {
        expect(
          container.env.find((entry) => entry.name === key)?.valueFrom
            ?.secretKeyRef,
        ).toMatchObject({ name: credentials });
      }
    }
    expect(
      pod.containers[0]?.env.find(
        (entry) => entry.name === "FEEDS_DATABASE_PATH",
      )?.value,
    ).toBe("/var/lib/feeds/feeds.sqlite");
  });

  test("emits only the inactive ConfigMap marker when explicitly gated off", () => {
    const rendered = createFeedsChart(new App(), false).toJson();
    expect(rendered).toEqual([
      expect.objectContaining({
        kind: "ConfigMap",
        metadata: expect.objectContaining({ namespace: "feeds" }),
        data: { active: "false" },
      }),
    ]);
  });
});
