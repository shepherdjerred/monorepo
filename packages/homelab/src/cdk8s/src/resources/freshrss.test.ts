import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createFreshRssChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/freshrss.ts";
import { FreshRssDesiredManifestSchema } from "./freshrss-opml.ts";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

async function synthesize(): Promise<unknown[]> {
  const app = new App();
  await createFreshRssChart(app);
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
  if (manifest === undefined) throw new Error(`Missing ${kind}/${name}`);
  return manifest;
}

describe("FreshRSS chart", () => {
  test("packages the validated OPML, normalized manifest, and reconciler", async () => {
    const configMap = z
      .object({
        data: z.object({
          "config.custom.php": z.string(),
          "feeds.opml": z.string(),
          "repo-stack.opml": z.string(),
          "desired.json": z.string(),
          "reconcile.ts": z.string(),
          "freshrss-exported-opml.ts": z.string(),
          "freshrss-subscription-safety.ts": z.string(),
          "reconcile-filters.php": z.string(),
        }),
      })
      .parse(
        findManifest(
          await synthesize(),
          "ConfigMap",
          "freshrss-declarative-config",
        ),
      );
    const desiredValue: unknown = JSON.parse(configMap.data["desired.json"]);
    const desired = FreshRssDesiredManifestSchema.parse(desiredValue);

    expect(desired.feeds).toHaveLength(40);
    expect(configMap.data["config.custom.php"]).toContain(
      "'api_enabled' => true",
    );
    expect(configMap.data["repo-stack.opml"]).toContain(
      'outline text="Repo Stack"',
    );
    expect(configMap.data["repo-stack.opml"]).not.toContain(
      'outline text="Uncategorized"',
    );
    expect(configMap.data["reconcile.ts"]).toContain("reconcileFreshRss");
    expect(configMap.data["reconcile-filters.php"]).toContain(
      "FreshRSS_Factory::createFeedDao",
    );
  });

  test("enables the API without blocking setup and reconciles user settings after startup", async () => {
    const manifests = await synthesize();
    const item = z
      .object({ spec: z.object({ itemPath: z.string() }) })
      .parse(findManifest(manifests, "OnePasswordItem", "freshrss-sync"));
    const deployment = z
      .object({
        spec: z.object({
          template: z.object({
            spec: z.object({
              automountServiceAccountToken: z.literal(false),
              initContainers: z
                .array(z.object({ name: z.string() }).loose())
                .optional(),
              containers: z.array(
                z
                  .object({
                    name: z.string(),
                    args: z.array(z.string()).optional(),
                    securityContext: z.unknown().optional(),
                    volumeMounts: z.array(z.unknown()),
                  })
                  .loose(),
              ),
            }),
          }),
        }),
      })
      .parse(findManifest(manifests, "Deployment", "freshrss"));
    expect(item.spec.itemPath).toMatch(/\/items\/freshrss-sync$/u);
    expect(
      deployment.spec.template.spec.initContainers?.some(
        (container) => container.name === "configure-api",
      ) ?? false,
    ).toBe(false);
    expect(
      JSON.stringify(deployment.spec.template.spec.containers[0]?.volumeMounts),
    ).toContain("config.custom.php");

    const localSettingsReconciler =
      deployment.spec.template.spec.containers.find(
        (container) => container.name === "reconcile-local-settings",
      );
    if (localSettingsReconciler === undefined)
      throw new Error("Missing FreshRSS local settings reconciler");
    expect(localSettingsReconciler.args?.[0]).toContain("sha256sum");
    expect(localSettingsReconciler.args?.[0]).toContain("update-user.php");
    expect(localSettingsReconciler.args?.[0]).toContain(
      "reconcile-filters.php",
    );
    expect(
      z
        .object({
          runAsUser: z.literal(33),
          runAsGroup: z.literal(33),
          runAsNonRoot: z.literal(true),
        })
        .loose()
        .parse(localSettingsReconciler.securityContext),
    ).toBeDefined();
    expect(JSON.stringify(localSettingsReconciler.volumeMounts)).toContain(
      "/run/secrets/freshrss",
    );
    expect(JSON.stringify(localSettingsReconciler.volumeMounts)).toContain(
      "/config",
    );
  });

  test("renders the bounded hardened hourly reconciler", async () => {
    const cronJob = z
      .object({
        spec: z.object({
          schedule: z.literal("7 * * * *"),
          timeZone: z.literal("America/Los_Angeles"),
          concurrencyPolicy: z.literal("Forbid"),
          startingDeadlineSeconds: z.literal(300),
          successfulJobsHistoryLimit: z.literal(1),
          failedJobsHistoryLimit: z.literal(3),
          jobTemplate: z.object({
            spec: z.object({
              activeDeadlineSeconds: z.literal(300),
              backoffLimit: z.literal(1),
              template: z.object({
                metadata: z.object({
                  labels: z.object({ app: z.literal("freshrss-sync") }),
                }),
                spec: z.object({
                  automountServiceAccountToken: z.literal(false),
                  containers: z.array(
                    z
                      .object({
                        image: z.string(),
                        env: z.array(z.unknown()),
                        resources: z.unknown(),
                        securityContext: z.unknown(),
                        volumeMounts: z.array(z.unknown()),
                      })
                      .loose(),
                  ),
                }),
              }),
            }),
          }),
        }),
      })
      .parse(findManifest(await synthesize(), "CronJob", "freshrss-sync"));
    const container = cronJob.spec.jobTemplate.spec.template.spec.containers[0];
    if (container === undefined)
      throw new Error("Missing FreshRSS sync container");

    expect(container.image).toMatch(
      /^docker\.io\/oven\/bun:1\.3\.14-slim@sha256:[a-f0-9]{64}$/,
    );
    expect(container.resources).toEqual({
      limits: { cpu: "250m", memory: "128Mi" },
      requests: { cpu: "25m", memory: "64Mi" },
    });
    expect(container.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
      runAsGroup: 1000,
      runAsNonRoot: true,
      runAsUser: 1000,
    });
    expect(JSON.stringify(container.env)).toContain("FRESHRSS_API_PASSWORD");
    expect(JSON.stringify(container.volumeMounts)).toContain('"readOnly":true');
  });

  test("admits only labeled reconciler pods through the namespace policy rule", async () => {
    const policy = z
      .object({
        spec: z.object({ ingress: z.array(z.unknown()) }),
      })
      .parse(
        findManifest(
          await synthesize(),
          "NetworkPolicy",
          "freshrss-ingress-netpol",
        ),
      );

    expect(policy.spec.ingress).toContainEqual({
      from: [{ podSelector: { matchLabels: { app: "freshrss-sync" } } }],
      ports: [{ port: 80, protocol: "TCP" }],
    });
  });
});
