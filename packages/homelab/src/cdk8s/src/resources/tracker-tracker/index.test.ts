import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createTrackerTrackerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/tracker-tracker.ts";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

function synthesize(): unknown[] {
  const app = new App();
  createTrackerTrackerChart(app);
  return z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
}

function findManifest(
  manifests: unknown[],
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
  if (manifest === undefined)
    throw new Error(`Missing ${kind}/${name} manifest`);
  return manifest;
}

describe("Tracker Tracker chart", () => {
  it("emits the app, PostgreSQL, persistent data, ingress, and policy resources", () => {
    const manifests = synthesize();
    const names = new Set(
      manifests.map((manifest) => {
        const parsed = ManifestSchema.parse(manifest);
        return `${parsed.kind}/${parsed.metadata.name}`;
      }),
    );

    expect(names).toEqual(
      new Set([
        "Namespace/tracker-tracker",
        "postgresql/tracker-tracker-postgresql",
        "OnePasswordItem/tracker-tracker-tracker-tracker-secrets",
        "ConfigMap/tracker-tracker-drizzle-config",
        "PersistentVolumeClaim/tracker-tracker-data-pvc",
        "Deployment/tracker-tracker",
        "Service/tracker-tracker-tracker-tracker-service",
        "Ingress/tracker-tracker-tracker-tracker-ingress-ingress",
        "NetworkPolicy/tracker-tracker-network-policy",
      ]),
    );

    const deployment = findManifest(manifests, "Deployment", "tracker-tracker");
    const deploymentLabels = z
      .object({
        spec: z.object({
          template: z.object({
            metadata: z
              .object({
                labels: z.object({ app: z.literal("tracker-tracker") }).loose(),
              })
              .loose(),
            spec: z
              .object({
                containers: z.array(
                  z
                    .object({
                      image: z.literal(
                        "ghcr.io/jordanlambrecht/tracker-tracker:2.10.0@sha256:f7e4b80a928714dd361f125ddd5cb5db6bb372a7a1694ca4e8ac7fe67313e824",
                      ),
                      env: z.array(z.object({ name: z.string() }).loose()),
                      readinessProbe: z
                        .object({
                          httpGet: z
                            .object({ path: z.literal("/api/health") })
                            .loose(),
                        })
                        .loose(),
                      volumeMounts: z.array(
                        z.object({ mountPath: z.string() }).loose(),
                      ),
                    })
                    .loose(),
                ),
              })
              .loose(),
          }),
        }),
      })
      .parse(deployment);
    expect(deploymentLabels.spec.template.metadata.labels.app).toBe(
      "tracker-tracker",
    );
    const envNames = new Set(
      deploymentLabels.spec.template.spec.containers[0]?.env.map(
        ({ name }) => name,
      ),
    );
    expect(envNames).toEqual(
      new Set([
        "TZ",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "SESSION_SECRET",
        "SECURE_COOKIES",
        "LOG_LEVEL",
      ]),
    );
    expect([...envNames].some((name) => name.includes("QBIT"))).toBe(false);
    expect([...envNames].some((name) => name.includes("TRACKER"))).toBe(false);
    const database = z
      .object({
        spec: z
          .object({
            numberOfInstances: z.literal(1),
            postgresql: z.object({ version: z.literal("16") }).loose(),
            volume: z
              .object({
                size: z.literal("16Gi"),
                storageClass: z.literal("zfs-ssd"),
              })
              .loose(),
            patroni: z.object({ pg_hba: z.array(z.string()) }).loose(),
          })
          .loose(),
      })
      .parse(
        findManifest(manifests, "postgresql", "tracker-tracker-postgresql"),
      );
    expect(database.spec.patroni.pg_hba).toContain(
      "host tracker_tracker trackertracker all scram-sha-256",
    );

    const pvc = z
      .object({
        metadata: z
          .object({
            name: z.literal("tracker-tracker-data-pvc"),
            labels: z
              .object({
                "velero.io/backup": z.literal("enabled"),
                "velero.io/exclude-from-backup": z.literal("false"),
              })
              .loose(),
          })
          .loose(),
        spec: z
          .object({
            resources: z
              .object({
                requests: z.object({ storage: z.literal("8Gi") }).loose(),
              })
              .loose(),
          })
          .loose(),
      })
      .parse(
        findManifest(
          manifests,
          "PersistentVolumeClaim",
          "tracker-tracker-data-pvc",
        ),
      );
    expect(pvc.metadata.name).toBe("tracker-tracker-data-pvc");

    const secretItem = z
      .object({ spec: z.object({ itemPath: z.string() }).loose() })
      .parse(
        findManifest(
          manifests,
          "OnePasswordItem",
          "tracker-tracker-tracker-tracker-secrets",
        ),
      );
    expect(secretItem.spec.itemPath).toContain("pp6oihrkeftnpj6zlcfoyv3d6q");

    const ingress = z
      .object({
        spec: z
          .object({
            ingressClassName: z.literal("tailscale"),
            tls: z.array(
              z
                .object({ hosts: z.array(z.literal("tracker-tracker")) })
                .loose(),
            ),
          })
          .loose(),
      })
      .parse(
        findManifest(
          manifests,
          "Ingress",
          "tracker-tracker-tracker-tracker-ingress-ingress",
        ),
      );
    expect(ingress.spec.tls).toHaveLength(1);

    const networkPolicy = z
      .object({
        spec: z
          .object({
            podSelector: z
              .object({
                matchLabels: z
                  .object({ app: z.literal("tracker-tracker") })
                  .loose(),
              })
              .loose(),
            ingress: z.array(z.unknown()),
            egress: z.array(z.unknown()),
          })
          .loose(),
      })
      .parse(
        findManifest(
          manifests,
          "NetworkPolicy",
          "tracker-tracker-network-policy",
        ),
      );
    expect(networkPolicy.spec.ingress).toHaveLength(1);
    expect(networkPolicy.spec.egress).toHaveLength(4);
  });
});

describe("Tracker Tracker schema sync", () => {
  it("mounts a Drizzle config that excludes PostgreSQL extension objects", () => {
    const manifests = synthesize();
    const deployment = z
      .object({
        spec: z
          .object({
            template: z
              .object({
                spec: z
                  .object({
                    containers: z.array(
                      z
                        .object({
                          volumeMounts: z
                            .array(z.object({ mountPath: z.string() }).loose())
                            .length(2),
                        })
                        .loose(),
                    ),
                  })
                  .loose(),
              })
              .loose(),
          })
          .loose(),
      })
      .parse(findManifest(manifests, "Deployment", "tracker-tracker"));
    expect(
      new Set(
        deployment.spec.template.spec.containers[0]?.volumeMounts.map(
          ({ mountPath }) => mountPath,
        ),
      ),
    ).toEqual(new Set(["/data", "/schema-sync/drizzle.config.ts"]));

    const drizzleConfig = z
      .object({
        data: z.object({ "drizzle.config.ts": z.string() }),
      })
      .parse(
        findManifest(manifests, "ConfigMap", "tracker-tracker-drizzle-config"),
      );
    expect(drizzleConfig.data["drizzle.config.ts"]).toContain(
      'tablesFilter: ["*"],',
    );
    expect(drizzleConfig.data["drizzle.config.ts"]).toContain(
      'schemaFilter: ["public"],',
    );
    expect(drizzleConfig.data["drizzle.config.ts"]).toContain(
      'extensionsFilters: ["pg_stat_statements"],',
    );
  });
});
