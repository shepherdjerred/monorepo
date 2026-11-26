import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createAlertDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/alert-dashboard.ts";
import { buildPostgresUrlExpr } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";

const SecurityContextSchema = z
  .object({
    allowPrivilegeEscalation: z.literal(false),
    capabilities: z.object({ drop: z.array(z.string()) }),
    privileged: z.literal(false),
    readOnlyRootFilesystem: z.literal(true),
    runAsGroup: z.literal(1000),
    runAsNonRoot: z.literal(true),
    runAsUser: z.literal(1000),
    seccompProfile: z.object({ type: z.literal("RuntimeDefault") }),
  })
  .loose();

const ContainerSchema = z
  .object({
    name: z.string(),
    args: z.array(z.string()).optional(),
    volumeMounts: z.array(
      z.object({ name: z.string(), mountPath: z.string() }).loose(),
    ),
    env: z
      .array(
        z
          .object({
            name: z.string(),
            value: z.string().optional(),
            valueFrom: z
              .object({
                secretKeyRef: z
                  .object({
                    key: z.string(),
                    optional: z.boolean().optional(),
                  })
                  .loose(),
              })
              .optional(),
          })
          .loose(),
      )
      .optional(),
    securityContext: SecurityContextSchema,
  })
  .loose();

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.literal("alert-dashboard") }).loose(),
  spec: z.object({
    template: z.object({
      spec: z
        .object({
          volumes: z.array(
            z
              .object({
                name: z.string(),
                persistentVolumeClaim: z
                  .object({ claimName: z.string() })
                  .loose()
                  .optional(),
              })
              .loose(),
          ),
          initContainers: z.array(ContainerSchema),
          containers: z.array(ContainerSchema),
        })
        .loose(),
    }),
  }),
});

const PersistentVolumeClaimSchema = z.object({
  kind: z.literal("PersistentVolumeClaim"),
  metadata: z.object({ name: z.literal("alert-dashboard-data") }).loose(),
  spec: z.object({
    resources: z.object({ requests: z.object({ storage: z.string() }) }),
  }),
});

const DATA_PATH = "/data";
const DATABASE_URL = "file:/data/alert-dashboard.db";
const MAIL_API_URL = "http://mail.mail.svc.cluster.local:7371";

function synthesizeDeployment(): z.infer<typeof DeploymentSchema> {
  const app = new App();
  createAlertDashboardChart(app);
  const manifests = z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
  const deployment = manifests
    .map((manifest) => DeploymentSchema.safeParse(manifest))
    .find((result) => result.success)?.data;
  if (deployment === undefined) {
    throw new Error("Missing Deployment/alert-dashboard manifest");
  }
  return deployment;
}

const IngressSchema = z.object({
  kind: z.literal("Ingress"),
  spec: z
    .object({
      ingressClassName: z.string(),
      tls: z.array(z.object({ hosts: z.array(z.string()) })),
    })
    .loose(),
});

function synthesizeTailnetHosts(): string[] {
  const app = new App();
  createAlertDashboardChart(app);
  const manifests = z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
  return manifests
    .map((manifest) => IngressSchema.safeParse(manifest))
    .filter((result) => result.success)
    .filter((result) => result.data.spec.ingressClassName === "tailscale")
    .flatMap((result) => result.data.spec.tls.flatMap((tls) => tls.hosts));
}

function synthesizePersistentVolumeClaim(): z.infer<
  typeof PersistentVolumeClaimSchema
> {
  const app = new App();
  createAlertDashboardChart(app);
  const manifests = z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
  const claim = manifests
    .map((manifest) => PersistentVolumeClaimSchema.safeParse(manifest))
    .find((result) => result.success)?.data;
  if (claim === undefined) {
    throw new Error("Missing alert-dashboard data claim");
  }
  return claim;
}

describe("Alert Dashboard deployment", () => {
  test("reserves enough ZFS quota for the ledger and retained snapshots", () => {
    expect(
      synthesizePersistentVolumeClaim().spec.resources.requests.storage,
    ).toBe("64Gi");
  });

  test("opens the SQLite ledger on the persistent data volume in every container that touches it", () => {
    const podSpec = synthesizeDeployment().spec.template.spec;
    const dataVolume = podSpec.volumes.find(
      (volume) =>
        volume.persistentVolumeClaim?.claimName === "alert-dashboard-data",
    );
    expect(dataVolume?.persistentVolumeClaim?.claimName).toBe(
      "alert-dashboard-data",
    );

    const ledgerContainers = [
      ...podSpec.initContainers.filter(
        (container) => container.name !== "incidents-prisma-migrate",
      ),
      ...podSpec.containers,
    ];
    expect(ledgerContainers.map((container) => container.name)).toEqual([
      "prisma-migrate",
      "alert-dashboard",
    ]);

    for (const container of ledgerContainers) {
      const dataMount = container.volumeMounts.find(
        (mount) => mount.mountPath === DATA_PATH,
      );
      expect(dataMount?.name).toBe(dataVolume?.name);
      expect(
        container.env?.find((entry) => entry.name === "DATABASE_URL")?.value,
      ).toBe(DATABASE_URL);
    }

    expect(podSpec.initContainers.at(0)?.args).toEqual([
      "cd /app/packages/alert-dashboard && bunx --no-install prisma migrate deploy",
    ]);
  });

  test("keeps the main-branch container hardening on every container", () => {
    const podSpec = synthesizeDeployment().spec.template.spec;
    const allContainers = [...podSpec.initContainers, ...podSpec.containers];
    expect(allContainers).toHaveLength(3);

    for (const container of allContainers) {
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
    }
  });

  test("migrates and connects Incidents to its own PostgreSQL without touching Hub's SQLite URL", () => {
    const podSpec = synthesizeDeployment().spec.template.spec;
    const migrate = podSpec.initContainers.find(
      (container) => container.name === "incidents-prisma-migrate",
    );
    const server = podSpec.containers.find(
      (container) => container.name === "alert-dashboard",
    );
    expect(podSpec.initContainers.map((container) => container.name)).toEqual([
      "prisma-migrate",
      "incidents-prisma-migrate",
    ]);
    expect(migrate?.args).toEqual([
      "cd /app/packages/incidents && bunx --no-install prisma migrate deploy",
    ]);
    const credentials =
      "incidents.incidents-postgresql.credentials.postgresql.acid.zalan.do";
    for (const container of [migrate, server]) {
      const env = container?.env ?? [];
      const names = env.map((entry) => entry.name);
      // kubelet expands `$(DB_USER)` only from variables declared earlier.
      expect(names.indexOf("DB_USER")).toBeLessThan(
        names.indexOf("INCIDENTS_DATABASE_URL"),
      );
      expect(names.indexOf("DB_PASSWORD")).toBeLessThan(
        names.indexOf("INCIDENTS_DATABASE_URL"),
      );
      expect(names.indexOf("DB_USER")).toBeGreaterThanOrEqual(0);
      expect(
        env.find((entry) => entry.name === "INCIDENTS_DATABASE_URL")?.value,
      ).toBe(buildPostgresUrlExpr("incidents-postgresql:5432", "incidents_db"));
      for (const key of ["DB_USER", "DB_PASSWORD"]) {
        const ref = env.find((entry) => entry.name === key)?.valueFrom
          ?.secretKeyRef;
        expect(ref).toMatchObject({ name: credentials });
        expect(ref?.optional).not.toBe(true);
      }
    }
    expect(
      server?.env?.find((entry) => entry.name === "DATABASE_URL")?.value,
    ).toBe(DATABASE_URL);
    expect(migrate?.env?.some((entry) => entry.name === "DATABASE_URL")).toBe(
      false,
    );
  });

  test("uses the outbound mail broker HTTP API for email delivery", () => {
    const podSpec = synthesizeDeployment().spec.template.spec;
    const dashboardContainer = podSpec.containers.find(
      (container) => container.name === "alert-dashboard",
    );

    expect(
      dashboardContainer?.env?.find((entry) => entry.name === "MAIL_API_URL")
        ?.value,
    ).toBe(MAIL_API_URL);
    expect(
      dashboardContainer?.env?.find((entry) => entry.name === "MAIL_API_TOKEN")
        ?.valueFrom?.secretKeyRef,
    ).toMatchObject({ key: "MAIL_API_TOKEN" });
    expect(
      dashboardContainer?.env?.some((entry) =>
        entry.name.startsWith("POSTAL_"),
      ),
    ).toBe(false);
  });

  test("serves Hub on the hub tailnet host only", () => {
    expect(synthesizeTailnetHosts()).toEqual(["hub"]);
  });

  test("requires the ops ingest and Home Assistant tokens and wires Prometheus, Home Assistant and Flags", () => {
    const env =
      synthesizeDeployment().spec.template.spec.containers.find(
        (container) => container.name === "alert-dashboard",
      )?.env ?? [];
    const entry = (name: string) => env.find((item) => item.name === name);

    expect(entry("OPS_INGEST_TOKEN")?.valueFrom?.secretKeyRef).toMatchObject({
      key: "OPS_INGEST_TOKEN",
    });
    expect(
      entry("OPS_INGEST_TOKEN")?.valueFrom?.secretKeyRef.optional,
    ).not.toBe(true);
    expect(entry("HOMEASSISTANT_URL")?.value).toBe(
      "http://home-homeassistant-service.home.svc.cluster.local:8123",
    );
    expect(entry("HOMEASSISTANT_TOKEN")?.valueFrom?.secretKeyRef).toMatchObject(
      {
        key: "HOMEASSISTANT_TOKEN",
        name: "alert-dashboard-alert-dashboard-ha-1p",
      },
    );
    expect(
      entry("HOMEASSISTANT_TOKEN")?.valueFrom?.secretKeyRef.optional,
    ).not.toBe(true);
    expect(entry("PROMETHEUS_URL")?.value).toBe(
      "http://prometheus-kube-prometheus-prometheus.prometheus:9090",
    );
    expect(entry("FEATURE_FLAGS_MODE")?.value).toBe("flags");
    expect(entry("FLAGS_DEPLOYMENT")?.value).toBe("alert-dashboard/prod");
    expect(entry("FLAGS_URL")?.value).toBe(
      "http://flags.flags.svc.cluster.local:7361",
    );
  });

  test("wires Tempo and SeaweedFS llm-archive access with required S3 credentials", () => {
    const env =
      synthesizeDeployment().spec.template.spec.containers.find(
        (container) => container.name === "alert-dashboard",
      )?.env ?? [];
    const entry = (name: string) => env.find((item) => item.name === name);

    expect(entry("TEMPO_URL")?.value).toBe(
      "http://tempo.tempo.svc.cluster.local:3200",
    );
    expect(entry("LLM_ARCHIVE_S3_BUCKET")?.value).toBe("llm-archive");
    expect(entry("LLM_ARCHIVE_S3_PREFIX")?.value).toBe("llm");
    expect(entry("S3_ENDPOINT")?.value).toBe(
      "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    );
    const keyIdRef = entry("AWS_ACCESS_KEY_ID")?.valueFrom?.secretKeyRef;
    const secretRef = entry("AWS_SECRET_ACCESS_KEY")?.valueFrom?.secretKeyRef;
    expect(keyIdRef).toMatchObject({
      key: "SEAWEEDFS_ACCESS_KEY_ID",
      name: "alert-dashboard-alert-dashboard-s3-1p",
    });
    expect(keyIdRef?.optional).not.toBe(true);
    expect(secretRef).toMatchObject({
      key: "SEAWEEDFS_SECRET_ACCESS_KEY",
      name: "alert-dashboard-alert-dashboard-s3-1p",
    });
    expect(secretRef?.optional).not.toBe(true);
  });
});
