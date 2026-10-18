import { App } from "cdk8s";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify, parseAllDocuments } from "yaml";
import { createAppsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/apps.ts";
import { createDeliveryApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/delivery.ts";
import { createDeliveryControlPlaneApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/delivery-control-plane.ts";
import { reviewedAccountSource } from "homelab/scripts/ci/bootstrap-account-policy.ts";
import { assertBootstrapMaintenance } from "homelab/scripts/ci/bootstrap-maintenance.ts";
import {
  assertBootstrapImageSource,
  assertBootstrapControlPlaneImage,
} from "homelab/scripts/ci/bootstrap-image-proof.ts";
import {
  CONTROL_PLANE_IMAGE_ABI,
  CONTROL_PLANE_IMAGE_LABEL,
} from "@shepherdjerred/ops-model/delivery-control-plane.ts";
import { bootstrapOperationReceipt } from "homelab/scripts/ci/bootstrap-native.ts";
import { bootstrapCredentials } from "homelab/scripts/ci/bootstrap-auth.ts";
import verifiedRoot from "@shepherdjerred/ops-model/fixtures/verified-root-release.json" with { type: "json" };
import {
  assertExternalBootstrapPath,
  createBootstrapDirectory,
} from "homelab/scripts/ci/bootstrap-output.ts";
import {
  BootstrapApplicationSchema,
  BootstrapDescriptorSchema,
  bootstrapRootManifest,
} from "homelab/scripts/ci/bootstrap-selection.ts";

test("actual root self-reference survives paused account prerequisite then selected API bootstrap", async () => {
  const app = new App();
  await createAppsChart(app);
  const chart = app.charts.find((candidate) => candidate.node.id === "apps");
  if (chart === undefined) throw new Error("Missing actual apps chart");
  createDeliveryApp(chart);
  createDeliveryControlPlaneApp(chart);
  const documents = z
    .array(
      z
        .object({ kind: z.string(), metadata: z.object({ name: z.string() }) })
        .loose(),
    )
    .parse(chart.toJson());
  const previous = documents.filter(
    (value) =>
      !["delivery", "delivery-control-plane"].includes(value.metadata.name),
  );
  const priorArgo = previous.find((value) => value.metadata.name === "argocd");
  if (priorArgo === undefined)
    throw new Error("Missing native Argo prerequisite");
  const oldSpec = z
    .object({
      source: z
        .object({
          helm: z
            .object({
              valuesObject: z
                .object({
                  configs: z
                    .object({ cm: z.record(z.string(), z.json()) })
                    .loose(),
                })
                .loose(),
            })
            .loose(),
        })
        .loose(),
    })
    .loose()
    .parse(priorArgo["spec"]);
  oldSpec.source.helm.valuesObject.configs.cm = Object.fromEntries(
    Object.entries(oldSpec.source.helm.valuesObject.configs.cm).filter(
      ([key]) =>
        !key.startsWith("accounts.delivery") &&
        key !== "server.rbac.disableApplicationFineGrainedRBACInheritance",
    ),
  );
  priorArgo["spec"] = oldSpec;
  const natives = previous
    .filter((value) => value.kind === "Application")
    .map((value) =>
      BootstrapApplicationSchema.parse({
        ...value,
        metadata: {
          ...value.metadata,
          uid: `native-${value.metadata.name}`,
          resourceVersion: "1",
        },
        status: {
          sync: { status: "Synced", revision: "2.0.0-600" },
          health: { status: "Healthy" },
        },
      }),
    );
  const root = natives.find((value) => value.metadata.name === "apps");
  const argo = natives.find((value) => value.metadata.name === "argocd");
  if (root === undefined || argo === undefined)
    throw new Error("Actual root/Argo self-managed applications missing");
  for (const value of [root, argo]) {
    const policy = z
      .record(z.string(), z.json())
      .parse(value.spec["syncPolicy"]);
    value.spec["syncPolicy"] = { ...policy, automated: { enabled: false } };
  }
  const observation = {
    status: {
      sync: { status: "OutOfSync" },
      resources: [
        { kind: "Application", name: "apps", status: "OutOfSync" },
        { kind: "Application", name: "argocd", status: "OutOfSync" },
      ],
    },
  };
  const manifests = previous.map((value) => JSON.stringify(value));
  assertBootstrapMaintenance(observation, natives, manifests);
  argo.spec["source"] = z.json().parse(reviewedAccountSource(argo));
  assertBootstrapMaintenance(observation, natives, manifests);
  const sourceRevision = "a".repeat(40);
  const descriptor = BootstrapDescriptorSchema.parse({
    schema: "delivery-bootstrap/v1",
    sourceRevision,
    pullRequest: 1,
    revision: "2.0.0-701",
    requestId: "11111111-1111-4111-8111-111111111111",
    targets: ["woodpecker", "delivery"],
    images: Object.fromEntries(
      (
        [
          ["woodpecker", "woodpecker-config-extension"],
          ["delivery", "delivery"],
        ] as const
      ).map(([key, name]) => [
        key,
        {
          repository: `docker.io/shepherdjerred/${name}`,
          sourceRevision,
          version: "2.0.0-700",
          digest: `sha256:${"b".repeat(64)}`,
        },
      ]),
    ),
  });
  const derived = parseAllDocuments(
    bootstrapRootManifest(
      documents.map((value) => stringify(value)).join("---\n"),
      natives,
      descriptor,
      previous.map((value) => stringify(value)).join("---\n"),
    ),
  ).map((value) =>
    z
      .object({
        kind: z.string(),
        metadata: z.object({ name: z.string() }),
        spec: z.unknown().optional(),
      })
      .parse(value.toJSON()),
  );
  for (const native of natives.filter(
    (value) => value.metadata.name !== "woodpecker",
  ))
    expect(
      derived.find(
        (value) =>
          value.kind === "Application" &&
          value.metadata.name === native.metadata.name,
      )?.spec,
    ).toEqual(native.spec);
  expect(derived.some((value) => value.metadata.name === "delivery")).toBe(
    true,
  );
  expect(
    derived.some((value) => value.metadata.name === "delivery-control-plane"),
  ).toBe(false);
  expect(() =>
    assertBootstrapMaintenance(
      {
        status: {
          ...observation.status,
          resources: [
            { kind: "ConfigMap", name: "foreign", status: "OutOfSync" },
          ],
        },
      },
      natives,
      manifests,
    ),
  ).toThrow("shared-resource");
  root.spec["project"] = "unreviewed";
  expect(() =>
    assertBootstrapMaintenance(observation, natives, manifests),
  ).toThrow("Unreviewed");
});

test("OCI source proof validates every platform and requires production amd64", () => {
  const source = "a".repeat(40);
  const image = {
    os: "linux",
    architecture: "amd64",
    config: { Env: [`GIT_SHA=${source}`, "VERSION=2.0.0-700"] },
  };
  assertBootstrapImageSource(image, source, "2.0.0-700");
  assertBootstrapImageSource(
    {
      "linux/amd64": image,
      "linux/arm64": { ...image, architecture: "arm64" },
    },
    source,
    "2.0.0-700",
  );
  expect(() =>
    assertBootstrapImageSource(
      {
        "linux/amd64": image,
        "linux/arm64": { ...image, architecture: "arm64", config: { Env: [] } },
      },
      source,
      "2.0.0-700",
    ),
  ).toThrow("platform");
  expect(() =>
    assertBootstrapImageSource(
      { ...image, architecture: "arm64" },
      source,
      "2.0.0-700",
    ),
  ).toThrow("amd64");
});

test("initial control-plane hosting requires the Workflow capability on every platform", () => {
  const image = {
    os: "linux",
    architecture: "amd64",
    config: {
      Env: ["GIT_SHA=" + "a".repeat(40), "VERSION=2.0.0-700"],
      Labels: { [CONTROL_PLANE_IMAGE_LABEL]: CONTROL_PLANE_IMAGE_ABI },
    },
  };
  assertBootstrapControlPlaneImage(image);
  assertBootstrapControlPlaneImage({
    "linux/amd64": image,
    "linux/arm64": { ...image, architecture: "arm64" },
  });
  for (const labels of [
    {},
    { [CONTROL_PLANE_IMAGE_LABEL]: "delivery-control-plane/v1" },
  ]) {
    expect(() =>
      assertBootstrapControlPlaneImage({
        "linux/amd64": image,
        "linux/arm64": {
          ...image,
          architecture: "arm64",
          config: { ...image.config, Labels: labels },
        },
      }),
    ).toThrow("Workflow-host capability");
  }
});

test("receipt directories reject parent-prefix lookalikes and symlinks into Git", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delivery-bootstrap-path-"),
  );
  try {
    const repository = path.join(directory, "repository");
    await mkdir(repository);
    expect(() =>
      assertExternalBootstrapPath(
        repository,
        path.join(repository, "..receipts"),
      ),
    ).toThrow("outside");
    expect(() => assertExternalBootstrapPath(repository, repository)).toThrow(
      "outside",
    );
    assertExternalBootstrapPath(repository, path.join(directory, "outside"));
    const link = path.join(directory, "linked-parent");
    await symlink(repository, link);
    await expect(
      createBootstrapDirectory(repository, path.join(link, "receipt")),
    ).rejects.toThrow("outside");
    await createBootstrapDirectory(repository, path.join(directory, "receipt"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bootstrap preserves the real root protocol's verified termination, including maintenance pause", () => {
  const app = {
    ...structuredClone(verifiedRoot),
    metadata: { ...verifiedRoot.metadata, uid: "native-root" },
  };
  BootstrapApplicationSchema.parse(app);
  const request = verifiedRoot.status.operationState.operation.info.find(
    (entry) => entry.name === "ci.sjer.red/request-id",
  )?.value;
  expect(bootstrapOperationReceipt(app, z.uuid().parse(request))).toMatchObject(
    { application: "apps", applicationUid: "native-root" },
  );
  const paused = {
    ...app,
    status: {
      ...app.status,
      sync: { ...app.status.sync, status: "OutOfSync" },
    },
  };
  BootstrapApplicationSchema.parse(paused);
  expect(() =>
    bootstrapOperationReceipt(paused, z.uuid().parse(request)),
  ).toThrow("verified termination");
  app.status.operationState.message = "real sync failure";
  expect(() => BootstrapApplicationSchema.parse(app)).toThrow("verified root");
});

test("operator bootstrap and guarded root release require distinct independently observed principals", async () => {
  vi.stubEnv("ARGOCD_TOKEN", "test-operator");
  vi.stubEnv("ROOT_ARGOCD_TOKEN", "test-root");
  try {
    await expect(
      bootstrapCredentials(async (token) => ({
        loggedIn: true,
        username: token === "test-operator" ? "admin" : "woodpecker",
      })),
    ).resolves.toEqual({ ARGOCD_TOKEN: "test-root" });
    await expect(
      bootstrapCredentials(async () => ({ loggedIn: true, username: "admin" })),
    ).rejects.toThrow();
    await expect(
      bootstrapCredentials(async () => ({
        loggedIn: true,
        username: "woodpecker",
      })),
    ).rejects.toThrow();
    vi.stubEnv("ROOT_ARGOCD_TOKEN", "");
    await expect(bootstrapCredentials()).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
  }
});
