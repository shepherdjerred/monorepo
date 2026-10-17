import { expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createArcadeDeployment } from "./arcade.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";

const KindSchema = z.object({ kind: z.string() });
const NodeSelectorSchema = z.record(z.string(), z.string());
const DeploymentSchema = z.object({
  spec: z.object({
    replicas: z.number(),
    template: z.object({
      spec: z.object({ nodeSelector: NodeSelectorSchema }),
    }),
  }),
});
const PreparationSchema = z.object({
  metadata: z.object({ annotations: z.record(z.string(), z.string()) }),
  spec: z.object({
    activeDeadlineSeconds: z.number(),
    backoffLimit: z.number(),
    template: z.object({
      spec: z.object({
        automountServiceAccountToken: z.boolean(),
        nodeSelector: NodeSelectorSchema,
        containers: z.array(
          z.object({
            image: z.string(),
            command: z.array(z.string()),
            args: z.array(z.string()),
            securityContext: z.object({
              runAsNonRoot: z.boolean(),
              readOnlyRootFilesystem: z.boolean(),
              allowPrivilegeEscalation: z.boolean(),
            }),
            volumeMounts: z.array(z.object({ readOnly: z.boolean() })),
          }),
        ),
        volumes: z.array(
          z.object({
            persistentVolumeClaim: z.object({
              claimName: z.string(),
              readOnly: z.boolean(),
            }),
          }),
        ),
      }),
    }),
  }),
});

test("prepares storage with a read-only hook while the controller is dormant", () => {
  const chart = new Chart(new App(), "test", {
    namespace: "arcade",
    disableResourceNameHashes: true,
  });
  createArcadeDeployment(chart, { controllerActive: false });
  const resources = Testing.synth(chart);
  const find = (kind: string): unknown =>
    resources.find((resource) => KindSchema.parse(resource).kind === kind);
  const deployment = DeploymentSchema.parse(find("Deployment"));
  const preparation = PreparationSchema.parse(find("Job"));
  expect(deployment).toMatchObject({ spec: { replicas: 0 } });
  expect(preparation).toMatchObject({
    metadata: {
      annotations: {
        "argocd.argoproj.io/hook": "Sync",
        "argocd.argoproj.io/hook-delete-policy":
          "BeforeHookCreation,HookSucceeded",
      },
    },
    spec: {
      activeDeadlineSeconds: 300,
      backoffLimit: 1,
      template: {
        spec: {
          automountServiceAccountToken: false,
          nodeSelector: deployment.spec.template.spec.nodeSelector,
          containers: [
            expect.objectContaining({
              command: ["/bin/sh", "-ec"],
              args: [
                "test -d /storage/assets && test -d /storage/saves && test -d /storage/database",
              ],
              securityContext: expect.objectContaining({
                runAsNonRoot: true,
                readOnlyRootFilesystem: true,
                allowPrivilegeEscalation: false,
              }),
            }),
          ],
        },
      },
    },
  });
  const pod = preparation.spec.template.spec;
  const container = pod.containers[0];
  if (container === undefined)
    throw new Error("Missing storage preparation container");
  expect(pod.containers).toHaveLength(1);
  expect(container.image).toMatch(/^busybox:.*@sha256:[a-f0-9]{64}$/u);
  expect(pod.volumes.map((volume) => volume.persistentVolumeClaim)).toEqual(
    ["arcade-assets", "arcade-saves", "arcade-database"].map((claimName) => ({
      claimName,
      readOnly: true,
    })),
  );
  expect(container.volumeMounts).toHaveLength(3);
  expect(container.volumeMounts.every((mount) => mount.readOnly)).toBe(true);
  expect(JSON.stringify(find("Job"))).not.toContain('"secretKeyRef"');
  expect(
    resources.filter(
      (resource) => KindSchema.parse(resource).kind === "PersistentVolumeClaim",
    ),
  ).toHaveLength(3);
});

test("the active controller mounts storage without a competing bootstrap job", () => {
  const chart = new Chart(new App(), "test", {
    namespace: "arcade",
    disableResourceNameHashes: true,
  });
  createArcadeDeployment(chart);
  const resources = Testing.synth(chart);
  expect(
    DeploymentSchema.parse(
      resources.find(
        (resource) => KindSchema.parse(resource).kind === "Deployment",
      ),
    ),
  ).toMatchObject({ spec: { replicas: 1 } });
  expect(
    resources.some((resource) => KindSchema.parse(resource).kind === "Job"),
  ).toBe(false);
});

test("Arcade owns one credential item and keeps limits and goal grants outside its account pool", () => {
  const chart = new Chart(new App(), "test", {
    namespace: "arcade",
    disableResourceNameHashes: true,
  });
  createArcadeDeployment(chart);
  const resources = Testing.synth(chart);
  const credentials = z
    .object({
      metadata: z.object({ name: z.string() }),
      spec: z.object({ itemPath: z.string() }),
    })
    .parse(
      resources.find(
        (resource) =>
          KindSchema.parse(resource).kind === "OnePasswordItem" &&
          JSON.stringify(resource).includes("w4756fcswk2o5znfn4lzfqxgtm"),
      ),
    );
  const deployment = z
    .object({
      spec: z.object({
        template: z.object({
          spec: z.object({
            containers: z.array(
              z.object({
                env: ContainerEnvSchema,
              }),
            ),
            volumes: z.array(z.object({ secret: z.unknown().optional() })),
          }),
        }),
      }),
    })
    .parse(
      resources.find(
        (resource) => KindSchema.parse(resource).kind === "Deployment",
      ),
    );
  const container = deployment.spec.template.spec.containers[0];
  if (container === undefined) throw new Error("Missing Arcade container");
  for (const key of [
    "DISCORD_BOT_TOKEN",
    "DISCORD_APPLICATION_ID",
    "DISCORD_STREAMING_TOKENS",
    "DISCORD_CLIENT_SECRET",
    "CODEX_AUTH_JSON_B64",
  ]) {
    expect(
      container.env.find((entry) => entry.name === key)?.valueFrom
        ?.secretKeyRef,
    ).toEqual({ name: credentials.metadata.name, key });
  }
  expect(
    deployment.spec.template.spec.volumes.every(
      (volume) => volume.secret === undefined,
    ),
  ).toBe(true);
  const config = z
    .object({ data: z.object({ "arcade.toml": z.string() }) })
    .parse(
      resources.find(
        (resource) => KindSchema.parse(resource).kind === "ConfigMap",
      ),
    );
  expect(Bun.TOML.parse(config.data["arcade.toml"])).toMatchObject({
    maxSessions: 2,
    maxHeavySessions: 1,
    goalGuildIds: ["208425771172102144", "1337623164146155593"],
    driverFeed: { enabled: true, max_clients: 4 },
    streamVideo: { hardware_acceleration: true, bitrate_kbps: 5000 },
    emeraldStreamVideo: { hardware_acceleration: true, bitrate_kbps: 1500 },
    emeraldGoal: { enabled: true, model: "gpt-5.6-sol" },
  });
});
