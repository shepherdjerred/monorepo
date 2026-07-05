import { describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { setupCharts } from "./setup-charts.ts";

const SecurityContextSchema = z.looseObject({
  seLinuxOptions: z
    .object({
      level: z.string(),
    })
    .optional(),
});

const DeploymentSchema = z.looseObject({
  kind: z.literal("Deployment"),
  metadata: z.object({
    name: z.string(),
  }),
  spec: z.looseObject({
    template: z.looseObject({
      spec: z.looseObject({
        securityContext: SecurityContextSchema.optional(),
      }),
    }),
  }),
});

type Deployment = z.infer<typeof DeploymentSchema>;

const expectedSelinuxLevels = new Map([
  ["plausible-clickhouse", "s0:c101,c201"],
  ["scout-beta-scout-backend", "s0:c220,c221"],
  ["scout-prod-scout-backend", "s0:c222,c223"],
]);

async function synthesizeDeployments() {
  const app = new App({ outdir: ".test-synth-zfs-selinux" });
  await setupCharts(app);

  const deployments = new Map<string, Deployment>();
  const documents = app
    .synthYaml()
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0);

  for (const document of documents) {
    const parsed: unknown = parseYaml(document);
    const result = DeploymentSchema.safeParse(parsed);

    if (result.success) {
      deployments.set(result.data.metadata.name, result.data);
    }
  }

  return deployments;
}

describe("ZFS SELinux relabeling", () => {
  it("sets explicit SELinux labels on high-churn ZFS writers", async () => {
    const deployments = await synthesizeDeployments();

    for (const [name, level] of expectedSelinuxLevels) {
      const deployment = deployments.get(name);

      if (deployment === undefined) {
        throw new Error(`Missing deployment ${name}`);
      }

      expect(
        deployment.spec.template.spec.securityContext?.seLinuxOptions?.level,
      ).toBe(level);
    }
  });
});
