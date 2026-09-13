import { describe, expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createScoutDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/index.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      spec: z.object({
        initContainers: z
          .array(
            z.object({
              name: z.string(),
              image: z.string(),
              command: z.array(z.string()),
              env: z.array(z.object({ name: z.string() })),
              volumeMounts: z.array(z.object({ mountPath: z.string() })),
            }),
          )
          .optional(),
      }),
    }),
  }),
});

function synthesizeScoutDeployment(
  retirementPreflightImageDigests?: ReadonlySet<string>,
) {
  const app = new App();
  const chart = new Chart(app, "scout-beta", {
    namespace: "scout-beta",
    disableResourceNameHashes: true,
  });
  createScoutDeployment(chart, "beta", retirementPreflightImageDigests);
  const manifests = z.array(z.unknown()).parse(Testing.synth(chart));
  return DeploymentSchema.parse(
    manifests.find((manifest) => {
      const kind = z.object({ kind: z.string() }).safeParse(manifest);
      return kind.success && kind.data.kind === "Deployment";
    }),
  );
}

describe("Scout desktop retirement preflight", () => {
  const betaDigest =
    versions["shepherdjerred/scout-for-lol/beta"].split("@")[1];

  test("does not run from an image that has not been capability-marked", () => {
    const deployment = synthesizeScoutDeployment();
    expect(deployment.spec.template.spec.initContainers).toBeUndefined();
  });

  test("runs with only the data inventory inputs after image verification", () => {
    if (betaDigest === undefined) {
      throw new Error("Scout beta image must be digest-pinned");
    }
    const deployment = synthesizeScoutDeployment(new Set([betaDigest]));
    const initContainer = deployment.spec.template.spec.initContainers?.find(
      (container) => container.name === "desktop-retirement-preflight",
    );
    expect(initContainer).toMatchObject({
      image: `ghcr.io/shepherdjerred/scout-for-lol:${versions["shepherdjerred/scout-for-lol/beta"]}`,
      command: ["bun", "run", "scripts/retire-desktop-data.ts", "--preflight"],
      volumeMounts: [{ mountPath: "/data" }],
    });
    expect(initContainer?.env.map((entry) => entry.name).sort()).toEqual([
      "DATABASE_URL",
      "DB_PASSWORD",
      "DB_USER",
      "LEGACY_SQLITE_PATH",
      "TZ",
    ]);
  });
});
