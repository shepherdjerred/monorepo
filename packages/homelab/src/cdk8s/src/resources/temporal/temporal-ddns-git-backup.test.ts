import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";

const DeploymentSpecSchema = z
  .object({
    strategy: z.object({ type: z.string() }),
    template: z.object({
      spec: z.object({
        containers: z.array(
          z
            .object({
              env: z.array(
                z
                  .object({ name: z.string(), value: z.string().optional() })
                  .loose(),
              ),
              volumeMounts: z.array(
                z
                  .object({
                    mountPath: z.string(),
                    readOnly: z.boolean().optional(),
                  })
                  .loose(),
              ),
            })
            .loose(),
        ),
        volumes: z.array(
          z
            .object({
              secret: z
                .object({
                  secretName: z.string(),
                  items: z
                    .array(z.object({ key: z.string(), path: z.string() }))
                    .optional(),
                })
                .loose()
                .optional(),
              persistentVolumeClaim: z
                .object({ claimName: z.string() })
                .loose()
                .optional(),
            })
            .loose(),
        ),
      }),
    }),
  })
  .loose();

describe("Temporal DDNS and Git-Backup homelab wiring", () => {
  test("mounts DDNS Cloudflare token onto temporal-infra-worker and Git-Backup secret + 128Gi mirror cache PVC onto temporal-repo-worker", () => {
    const synthesized = synthesizeTemporalResources(
      ".test-synth-temporal-ddns-git-backup",
    );

    const ddnsItem = findTemporalResource(
      synthesized,
      "OnePasswordItem",
      "temporal-ddns-api-token",
    );
    expect(
      z.object({ itemPath: z.string() }).parse(ddnsItem.spec).itemPath,
    ).toMatch(/\/items\/nhyb6lnjpvjsau2gkmb7n42oeq$/u);

    const infraSpec = DeploymentSpecSchema.parse(
      findTemporalResource(
        synthesized,
        "Deployment",
        "temporal-temporal-infra-worker",
      ).spec,
    );
    const infraContainer = infraSpec.template.spec.containers[0];
    expect(infraContainer?.env).toContainEqual({
      name: "CLOUDFLARE_DDNS_API_TOKEN_FILE",
      value: "/run/secrets/ddns/api-token",
    });
    expect(infraContainer?.volumeMounts).toContainEqual(
      expect.objectContaining({
        mountPath: "/run/secrets/ddns",
        readOnly: true,
      }),
    );
    expect(infraSpec.template.spec.volumes).toContainEqual(
      expect.objectContaining({
        secret: expect.objectContaining({
          secretName: "temporal-ddns-api-token",
          items: [{ key: "api_token", path: "api-token" }],
        }),
      }),
    );

    const gitBackupItem = findTemporalResource(
      synthesized,
      "OnePasswordItem",
      "temporal-git-backup-github-token",
    );
    expect(
      z.object({ itemPath: z.string() }).parse(gitBackupItem.spec).itemPath,
    ).toMatch(/\/items\/zshiow4egtiuec5n7stcskyxmm$/u);

    const mirrorPvc = findTemporalResource(
      synthesized,
      "PersistentVolumeClaim",
      "temporal-git-mirror-cache",
    );
    expect(mirrorPvc.metadata).toMatchObject({
      name: "temporal-git-mirror-cache",
      annotations: {
        "argocd.argoproj.io/sync-wave": "3",
      },
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    });
    expect(mirrorPvc.spec).toMatchObject({
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: "128Gi" } },
    });

    const repoSpec = DeploymentSpecSchema.parse(
      findTemporalResource(
        synthesized,
        "Deployment",
        "temporal-temporal-repo-worker",
      ).spec,
    );
    expect(repoSpec.strategy.type).toBe("Recreate");
    const repoContainer = repoSpec.template.spec.containers[0];
    expect(repoContainer?.env).toContainEqual({
      name: "GIT_BACKUP_S3_BUCKET",
      value: "git-backups",
    });
    expect(repoContainer?.env).toContainEqual({
      name: "GIT_BACKUP_GITHUB_TOKEN_FILE",
      value: "/run/secrets/git-backup/password",
    });
    expect(repoContainer?.env).toContainEqual({
      name: "GIT_BACKUP_MIRROR_DIR",
      value: "/var/lib/git-backups/mirrors",
    });
    expect(repoContainer?.volumeMounts).toContainEqual(
      expect.objectContaining({
        mountPath: "/run/secrets/git-backup",
        readOnly: true,
      }),
    );
    expect(repoContainer?.volumeMounts).toContainEqual(
      expect.objectContaining({
        mountPath: "/var/lib/git-backups/mirrors",
      }),
    );
    expect(repoSpec.template.spec.volumes).toContainEqual(
      expect.objectContaining({
        secret: expect.objectContaining({
          secretName: "temporal-git-backup-github-token",
          items: [{ key: "password", path: "password" }],
        }),
      }),
    );
    expect(repoSpec.template.spec.volumes).toContainEqual(
      expect.objectContaining({
        persistentVolumeClaim: expect.objectContaining({
          claimName: "temporal-git-mirror-cache",
        }),
      }),
    );
  });
});
