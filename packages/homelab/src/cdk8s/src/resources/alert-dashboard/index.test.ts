import { describe, expect, test } from "bun:test";
import { App } from "cdk8s";
import { z } from "zod";
import { createAlertDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/alert-dashboard.ts";
import {
  ALERT_DASHBOARD_POSTGRES_CA_MOUNT_PATH,
  ALERT_DASHBOARD_POSTGRES_CA_SECRET,
  ALERT_DASHBOARD_POSTGRES_TLS_SECRET,
} from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/alert-dashboard-tls.ts";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z
      .object({
        name: z.string(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
  })
  .loose();

const VolumeMountSchema = z.object({
  mountPath: z.string(),
  name: z.string(),
  readOnly: z.boolean().optional(),
});

const ContainerSchema = z
  .object({
    name: z.string(),
    args: z.array(z.string()).optional(),
    volumeMounts: z.array(VolumeMountSchema),
  })
  .loose();

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z
    .object({
      name: z.literal("alert-dashboard"),
      annotations: z.record(z.string(), z.string()),
    })
    .loose(),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(ContainerSchema),
        initContainers: z.array(ContainerSchema),
        volumes: z.array(
          z
            .object({
              name: z.string(),
              secret: z
                .object({
                  secretName: z.string(),
                  items: z
                    .array(z.object({ key: z.string(), path: z.string() }))
                    .optional(),
                })
                .loose()
                .optional(),
            })
            .loose(),
        ),
      }),
    }),
  }),
});

function synthesize(): unknown[] {
  const app = new App();
  createAlertDashboardChart(app);
  return z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
}

function findManifest(
  manifests: readonly unknown[],
  kind: string,
  name: string,
): unknown {
  const manifest = manifests.find((candidate) => {
    const parsed = ManifestSchema.safeParse(candidate);
    return (
      parsed.success &&
      parsed.data.kind === kind &&
      parsed.data.metadata.name === name
    );
  });
  if (manifest === undefined) {
    throw new Error(`Missing ${kind}/${name}`);
  }
  return manifest;
}

function findContainer(
  containers: readonly z.infer<typeof ContainerSchema>[],
  name: string,
): z.infer<typeof ContainerSchema> {
  const container = containers.find((candidate) => candidate.name === name);
  if (container === undefined) throw new Error(`Missing container ${name}`);
  return container;
}

describe("Alert Dashboard deployment", () => {
  test("mounts the Zalando-normalized database user secret", () => {
    const deployment = DeploymentSchema.parse(
      findManifest(synthesize(), "Deployment", "alert-dashboard"),
    );
    const postgresSecret = deployment.spec.template.spec.volumes.find(
      (volume) => volume.name === "pg-secret",
    )?.secret?.secretName;

    expect(postgresSecret).toBe(
      "alert-dashboard.alert-dashboard-postgresql.credentials.postgresql.acid.zalan.do",
    );
  });

  test("issues a stable internal CA and a rotating DNS-verified server certificate", () => {
    const manifests = synthesize();
    const IssuerSchema = z.object({
      metadata: z.object({
        annotations: z.record(z.string(), z.string()),
      }),
      spec: z
        .object({
          selfSigned: z.object({}).optional(),
          ca: z.object({ secretName: z.string() }).optional(),
        })
        .loose(),
    });
    const CertificateSchema = z.object({
      metadata: z.object({
        annotations: z.record(z.string(), z.string()),
      }),
      spec: z
        .object({
          dnsNames: z.array(z.string()).optional(),
          duration: z.string(),
          isCA: z.boolean().optional(),
          issuerRef: z.object({ kind: z.string(), name: z.string() }),
          privateKey: z.object({
            algorithm: z.string(),
            encoding: z.string(),
            rotationPolicy: z.string(),
            size: z.number(),
          }),
          renewal: z.object({ policy: z.string() }).optional(),
          renewBefore: z.string().optional(),
          secretName: z.string(),
          usages: z.array(z.string()),
        })
        .loose(),
    });

    const selfSignedIssuer = IssuerSchema.parse(
      findManifest(
        manifests,
        "Issuer",
        "alert-dashboard-postgresql-selfsigned",
      ),
    );
    expect(selfSignedIssuer.metadata.annotations).toEqual({
      "argocd.argoproj.io/sync-wave": "-4",
    });
    expect(selfSignedIssuer.spec.selfSigned).toEqual({});

    const caCertificate = CertificateSchema.parse(
      findManifest(
        manifests,
        "Certificate",
        ALERT_DASHBOARD_POSTGRES_CA_SECRET,
      ),
    );
    expect(caCertificate.metadata.annotations).toEqual({
      "argocd.argoproj.io/sync-wave": "-3",
    });
    expect(caCertificate.spec).toMatchObject({
      duration: "87600h",
      isCA: true,
      issuerRef: {
        kind: "Issuer",
        name: "alert-dashboard-postgresql-selfsigned",
      },
      privateKey: {
        algorithm: "RSA",
        encoding: "PKCS8",
        rotationPolicy: "Never",
        size: 2048,
      },
      renewal: { policy: "Disabled" },
      secretName: ALERT_DASHBOARD_POSTGRES_CA_SECRET,
      usages: ["cert sign", "crl sign", "digital signature"],
    });

    const caIssuer = IssuerSchema.parse(
      findManifest(manifests, "Issuer", "alert-dashboard-postgresql-ca"),
    );
    expect(caIssuer.metadata.annotations).toEqual({
      "argocd.argoproj.io/sync-wave": "-2",
    });
    expect(caIssuer.spec.ca).toEqual({
      secretName: ALERT_DASHBOARD_POSTGRES_CA_SECRET,
    });

    const serverCertificate = CertificateSchema.parse(
      findManifest(
        manifests,
        "Certificate",
        ALERT_DASHBOARD_POSTGRES_TLS_SECRET,
      ),
    );
    expect(serverCertificate.metadata.annotations).toEqual({
      "argocd.argoproj.io/sync-wave": "-1",
    });
    expect(serverCertificate.spec).toMatchObject({
      dnsNames: [
        "alert-dashboard-postgresql",
        "alert-dashboard-postgresql.alert-dashboard",
        "alert-dashboard-postgresql.alert-dashboard.svc",
        "alert-dashboard-postgresql.alert-dashboard.svc.cluster.local",
      ],
      duration: "2160h",
      issuerRef: {
        kind: "Issuer",
        name: "alert-dashboard-postgresql-ca",
      },
      privateKey: {
        algorithm: "RSA",
        encoding: "PKCS8",
        rotationPolicy: "Always",
        size: 2048,
      },
      renewBefore: "360h",
      secretName: ALERT_DASHBOARD_POSTGRES_TLS_SECRET,
      usages: ["server auth", "digital signature", "key encipherment"],
    });
  });

  test("requires full PostgreSQL certificate verification without exposing the server key", () => {
    const manifests = synthesize();
    const postgres = z
      .object({
        spec: z.object({
          spiloFSGroup: z.literal(103),
          tls: z.object({
            caFile: z.literal("ca.crt"),
            secretName: z.literal(ALERT_DASHBOARD_POSTGRES_TLS_SECRET),
          }),
        }),
      })
      .parse(
        findManifest(manifests, "postgresql", "alert-dashboard-postgresql"),
      );
    expect(postgres.spec.tls.caFile).toBe("ca.crt");

    const deployment = DeploymentSchema.parse(
      findManifest(manifests, "Deployment", "alert-dashboard"),
    );
    expect(deployment.metadata.annotations).toEqual({
      "argocd.argoproj.io/sync-wave": "1",
    });
    const caVolume = deployment.spec.template.spec.volumes.find(
      (volume) => volume.name === "postgres-ca",
    );
    expect(caVolume?.secret).toEqual({
      secretName: ALERT_DASHBOARD_POSTGRES_TLS_SECRET,
      items: [{ key: "ca.crt", path: "ca.crt" }],
    });

    const buildUrl = findContainer(
      deployment.spec.template.spec.initContainers,
      "build-db-url",
    );
    const buildUrlScript = buildUrl.args?.join("\n") ?? "";
    expect(buildUrlScript).toContain(
      `alert-dashboard-postgresql:5432/alert_dashboard?sslmode=verify-full&sslrootcert=${ALERT_DASHBOARD_POSTGRES_CA_MOUNT_PATH}/ca.crt`,
    );
    expect(buildUrlScript).not.toContain("ssl=true");
    expect(buildUrlScript).not.toContain("no-verify");
    expect(buildUrlScript).not.toContain("rejectUnauthorized");

    const migrate = findContainer(
      deployment.spec.template.spec.initContainers,
      "prisma-migrate",
    );
    expect(migrate.args).toEqual([
      "export DATABASE_URL=$(cat /db-url/url) && cd /app/packages/alert-dashboard && bunx --no-install prisma migrate deploy",
    ]);
    const app = findContainer(
      deployment.spec.template.spec.containers,
      "alert-dashboard",
    );
    for (const container of [migrate, app]) {
      expect(
        container.volumeMounts.find(
          (mount) => mount.mountPath === ALERT_DASHBOARD_POSTGRES_CA_MOUNT_PATH,
        ),
      ).toEqual({
        mountPath: ALERT_DASHBOARD_POSTGRES_CA_MOUNT_PATH,
        name: "postgres-ca",
        readOnly: true,
      });
    }
  });
});
