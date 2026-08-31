import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createAlertDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/alert-dashboard.ts";

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
        z.object({ name: z.string(), value: z.string().optional() }).loose(),
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
const POSTAL_HOST =
  "http://postal-postal-web-service.postal.svc.cluster.local:5000";

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
    ).toBe("16Gi");
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

    const ledgerContainers = [...podSpec.initContainers, ...podSpec.containers];
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

  test("keeps the main-branch container hardening on the SQLite deployment", () => {
    const podSpec = synthesizeDeployment().spec.template.spec;
    const ledgerContainers = [...podSpec.initContainers, ...podSpec.containers];

    for (const container of ledgerContainers) {
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

  test("uses the rendered Postal web service for email delivery", () => {
    const podSpec = synthesizeDeployment().spec.template.spec;
    const dashboardContainer = podSpec.containers.find(
      (container) => container.name === "alert-dashboard",
    );

    expect(
      dashboardContainer?.env?.find((entry) => entry.name === "POSTAL_HOST")
        ?.value,
    ).toBe(POSTAL_HOST);
  });
});
