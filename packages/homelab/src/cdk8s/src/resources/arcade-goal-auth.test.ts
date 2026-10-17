import { expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createArcadeDeployment } from "./arcade.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";

const GoalContainer = z.object({
  env: ContainerEnvSchema,
  volumeMounts: z.array(z.object({ name: z.string(), mountPath: z.string() })),
});
const GoalPod = z.object({
  containers: z.array(GoalContainer),
  volumes: z.array(
    z.object({
      name: z.string(),
      persistentVolumeClaim: z.object({ claimName: z.string() }).optional(),
    }),
  ),
});

test("refreshable goal credentials mount separately from backed-up saves and database", () => {
  const chart = new Chart(new App(), "test", {
    namespace: "arcade",
    disableResourceNameHashes: true,
  });
  createArcadeDeployment(chart);
  const resources = Testing.synth(chart);
  const header = z.object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }),
  });
  const credentialClaim = resources.find(
    (r) => header.parse(r).metadata.name === "arcade-goal-auth",
  );
  expect(
    z
      .object({
        kind: z.string(),
        metadata: z.object({ labels: z.record(z.string(), z.string()) }),
      })
      .parse(credentialClaim),
  ).toMatchObject({
    kind: "PersistentVolumeClaim",
    metadata: {
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
  });
  const deployment = z
    .object({
      spec: z.object({
        template: z.object({
          spec: GoalPod,
        }),
      }),
    })
    .parse(resources.find((r) => header.parse(r).kind === "Deployment"));
  const pod = deployment.spec.template.spec;
  const container = pod.containers[0];
  if (container === undefined) throw new Error("Missing Arcade container");
  expect(container.env.find((e) => e.name === "CODEX_HOME")).toEqual({
    name: "CODEX_HOME",
    value: "/data/goal-auth/codex",
  });
  const mount = container.volumeMounts.find(
    (m) => m.mountPath === "/data/goal-auth",
  );
  expect(mount).toBeDefined();
  expect(
    pod.volumes.find((v) => v.name === mount?.name)?.persistentVolumeClaim,
  ).toEqual({ claimName: "arcade-goal-auth" });
  for (const claim of ["arcade-database", "arcade-saves"]) {
    expect(
      z
        .object({
          metadata: z.object({ labels: z.record(z.string(), z.string()) }),
        })
        .parse(resources.find((r) => header.parse(r).metadata.name === claim))
        .metadata.labels,
    ).toMatchObject({
      "velero.io/backup": "enabled",
      "velero.io/exclude-from-backup": "false",
    });
  }
});
