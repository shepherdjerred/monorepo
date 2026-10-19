import { App, Chart } from "cdk8s";
import { ConfigMap } from "cdk8s-plus-31";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify, parseAllDocuments } from "yaml";
import { createAppsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/apps.ts";
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
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import {
  discoverChartInputs,
  fingerprintChart,
} from "homelab/scripts/helm/helm-release-core.ts";
import { stageChart } from "homelab/scripts/helm/helm-push.ts";
import {
  bindChartImageDependencies,
  chartValidationValues,
} from "homelab/scripts/helm/helm-delivery-publication.ts";
import {
  bootstrapImages,
  prepareBootstrapManifest,
} from "homelab/scripts/ci/bootstrap-publication.ts";
import { createDeliveryControlPlaneChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery-control-plane.ts";
import { applyOrdinaryDeliveryImageBindings } from "@shepherdjerred/homelab/cdk8s/src/ordinary-delivery-image-bindings.ts";
import { renderBootstrapControlPlane } from "homelab/scripts/ci/bootstrap-control-plane-render.ts";
import verifiedRoot from "@shepherdjerred/ops-model/fixtures/verified-root-release.json" with { type: "json" };
import {
  assertExternalBootstrapPath,
  createBootstrapDirectory,
} from "homelab/scripts/ci/bootstrap-output.ts";
import {
  BootstrapApplicationSchema,
  BootstrapDescriptorSchema,
  bootstrapRootManifest,
  bootstrapRootTemplate,
} from "homelab/scripts/ci/bootstrap-selection.ts";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
function nativeBootstrapApplication(raw: unknown, revision = "2.0.0-600") {
  const doc = z
    .object({ metadata: z.object({ name: z.string() }).loose() })
    .loose()
    .parse(raw);
  return BootstrapApplicationSchema.parse({
    ...doc,
    metadata: {
      ...doc.metadata,
      uid: `native-${doc.metadata.name}`,
      resourceVersion: "1",
      annotations: Object.fromEntries(
        Object.entries(
          z
            .record(z.string(), z.string())
            .parse(doc.metadata["annotations"] ?? {}),
        ).filter(([key]) => key !== "delivery.shepherdjerred.com/environment"),
      ),
    },
    status: {
      sync: { status: "Synced", revision },
      health: { status: "Healthy" },
    },
  });
}

test("actual BOTH bootstrap stages and Helm renders reviewed images while retaining original dependencies and unrelated sources", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delivery-bootstrap-both-"),
  );
  const sourceRevision = "a".repeat(40);
  const descriptor = BootstrapDescriptorSchema.parse({
    schema: "delivery-bootstrap/v1",
    sourceRevision,
    pullRequest: 1,
    revision: "2.0.0-701",
    requestId: "11111111-1111-4111-8111-111111111111",
    targets: ["woodpecker", "delivery"],
    images: {
      woodpecker: {
        repository: "docker.io/shepherdjerred/woodpecker-config-extension",
        sourceRevision,
        version: "2.0.0-701",
        digest: digest("b"),
      },
      delivery: {
        repository: "docker.io/shepherdjerred/delivery",
        sourceRevision,
        version: "2.0.0-701",
        digest: digest("c"),
      },
    },
  });
  try {
    const output = path.join(directory, "dist");
    const app = new App({ outdir: output });
    await setupCharts(app);
    app.synth();
    const inputs = await discoverChartInputs(
      new URL("../../helm", import.meta.url).pathname,
      output,
    );
    const manifests = new Map(
      await Promise.all(
        inputs.map(
          async (input) =>
            [input.name, await Bun.file(input.manifestPath).text()] as const,
        ),
      ),
    );
    const previousRoot = bindChartImageDependencies(manifests.get("apps")!, {
      "shepherdjerred/caddy-s3proxy": digest("d"),
      "shepherdjerred/velero-plugin": digest("e"),
      "shepherdjerred/zfs-driver": digest("a"),
    });
    const priorDocuments = parseAllDocuments(previousRoot)
      .map((doc) => doc.toJSON())
      .filter((doc) => doc.metadata.name !== "delivery-control-plane");
    const natives = priorDocuments
      .filter((doc) => doc.kind === "Application")
      .map((doc) => nativeBootstrapApplication(doc, "2.0.0-700"));
    const captured = {
      root: natives.find((native) => native.metadata.name === "apps")!,
      applications: natives.filter((native) => native.metadata.name !== "apps"),
      priorRoot: priorDocuments.map((doc) => stringify(doc)).join("---\n"),
    };
    const maintenanceImage = `docker.io/shepherdjerred/temporal-worker:2.0.0-600@${digest("f")}`;
    const nativeWorker = bindChartImageDependencies(
      manifests.get("woodpecker")!,
      {
        "shepherdjerred/woodpecker-config-extension": digest("d"),
        "shepherdjerred/temporal-worker": digest("f"),
      },
    ).replaceAll(
      `docker.io/shepherdjerred/temporal-worker@${digest("f")}`,
      maintenanceImage,
    );
    const nativeResult = {
      manifests: parseAllDocuments(nativeWorker).map((doc) =>
        JSON.stringify(doc.toJSON()),
      ),
    };
    const read = vi.fn(() => Promise.resolve(nativeResult));
    const bindings = await bootstrapImages(descriptor, captured, read);
    expect(read).toHaveBeenCalledWith(
      "/woodpecker/manifests?revision=2.0.0-700",
    );
    expect(bindings.maintenanceImage).toBe(maintenanceImage);
    expect(bindings.digests).not.toHaveProperty("shepherdjerred/caddy-s3proxy");
    expect(bindings.digests).not.toHaveProperty("shepherdjerred/velero-plugin");
    expect(bindings.digests).not.toHaveProperty("shepherdjerred/zfs-driver");
    const rendered = new Map<string, any[]>();
    for (const name of ["apps", "woodpecker", "delivery"]) {
      const input = inputs.find((item) => item.name === name)!;
      const prepared = prepareBootstrapManifest(manifests.get(name)!, name, {
        descriptor,
        captured,
        bindings,
      });
      const manifestPath = path.join(directory, `${name}.yaml`);
      await Bun.write(manifestPath, bootstrapRootTemplate(prepared, name));
      const archive = await stageChart(
        { ...input, manifestPath },
        descriptor.revision,
        path.join(directory, name),
      );
      const child = Bun.spawn(
        [
          "helm",
          "template",
          name,
          archive,
          ...(name === "delivery"
            ? [
                "--set-string",
                `delivery.image=docker.io/shepherdjerred/delivery@${digest("c")}`,
              ]
            : []),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [text, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(error).toBe("");
      expect(code).toBe(0);
      rendered.set(
        name,
        parseAllDocuments(text, { version: "1.1" }).map((doc) => doc.toJSON()),
      );
    }
    const generator = rendered
      .get("woodpecker")!
      .find(
        (doc) =>
          doc.kind === "Deployment" &&
          doc.spec.template.metadata.labels.app ===
            "woodpecker-config-extension",
      );
    const expected = `docker.io/shepherdjerred/woodpecker-config-extension:2.0.0-701@${digest("b")}`;
    expect(generator.spec.template.spec.containers[0].image).toBe(expected);
    expect(
      generator.spec.template.spec.containers[0].env.find(
        (env: any) => env.name === "CI_GATE_IMAGE",
      ).value,
    ).toBe(expected);
    const maintenance = rendered
      .get("woodpecker")!
      .find(
        (doc) =>
          doc.kind === "Deployment" &&
          doc.metadata.name === "temporal-maintenance-worker",
      );
    expect(maintenance.spec.template.spec.containers[0].image).toBe(
      maintenanceImage,
    );
    expect(maintenance.spec.template.spec.initContainers[0].image).toBe(
      maintenanceImage,
    );
    const api = rendered
      .get("delivery")!
      .find((doc) => doc.kind === "Deployment");
    expect(api.spec.template.spec.containers[0].image).toBe(
      `docker.io/shepherdjerred/delivery@${digest("c")}`,
    );
    expect(api.spec.template.spec.initContainers[0].image).toBe(
      `docker.io/shepherdjerred/delivery@${digest("c")}`,
    );
    const selectedTargets = new Set<string>(descriptor.targets);
    for (const native of natives.filter(
      (item) => !selectedTargets.has(item.metadata.name),
    ))
      expect(
        rendered
          .get("apps")!
          .find(
            (doc) =>
              doc.kind === "Application" &&
              doc.metadata.name === native.metadata.name,
          ).spec,
      ).toEqual(native.spec);
    await expect(
      bootstrapImages(descriptor, captured, () =>
        Promise.resolve({
          manifests: nativeResult.manifests.map((raw) =>
            raw.replace(
              maintenanceImage,
              `docker.io/shepherdjerred/temporal-worker@${digest("d")}`,
            ),
          ),
        }),
      ),
    ).rejects.toThrow("init/runtime image differs");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("normal all-chart publication discovers and packages the actual control-plane synthesis", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delivery-chart-publication-"),
  );
  try {
    const output = path.join(directory, "dist");
    const app = new App({ outdir: output });
    await setupCharts(app);
    app.synth();
    const inputs = await discoverChartInputs(
      new URL("../../helm", import.meta.url).pathname,
      output,
    );
    const controller = inputs.find(
      (input) => input.name === "delivery-control-plane",
    );
    if (controller === undefined)
      throw new Error(
        "Actual control-plane chart is absent from publication inventory",
      );
    expect(inputs.map((input) => input.name)).toEqual(
      app.charts.map((chart) => chart.node.id).sort(),
    );
    const archive = await stageChart(
      controller,
      "2.0.0-1010825",
      path.join(directory, "staged"),
    );
    const validationPath = path.join(directory, "validation.yaml");
    await Bun.write(
      validationPath,
      stringify(chartValidationValues(controller.name)),
    );
    const rendered = Bun.spawnSync([
      "helm",
      "template",
      "delivery-control-plane",
      archive,
      "--values",
      validationPath,
    ]);
    expect(rendered.exitCode).toBe(0);
    expect(
      parseAllDocuments(rendered.stdout.toString()).some(
        (doc) => doc.toJSON() !== null,
      ),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("original archive bootstrap renders the fixed active hosts and rejects a real inactive ConfigMap archive", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delivery-bootstrap-hosts-"),
  );
  const image = {
    uri: "docker.io/shepherdjerred/temporal-worker",
    version: "2.0.0-800",
    digest: `sha256:${"a".repeat(64)}`,
  };
  try {
    for (const active of [true, false]) {
      const output = path.join(directory, active ? "active" : "inactive");
      const app = new App({ outdir: output });
      if (active)
        createDeliveryControlPlaneChart(app, {
          image: `docker.io/shepherdjerred/delivery@sha256:${"b".repeat(64)}`,
          serviceItemId: "test-service",
          executorItemId: "test-executor",
          argocdItemId: "test-workload-argocd",
          platformRegistryItemId: "test-registry",
          platformArgocdItemId: "test-platform-argocd",
        });
      else
        new ConfigMap(
          new Chart(app, "delivery-control-plane", {
            namespace: "temporal",
            disableResourceNameHashes: true,
          }),
          "activation",
          { data: { active: "false" } },
        );
      applyOrdinaryDeliveryImageBindings(app);
      app.synth();
      const chartDirectory = new URL(
        "../../helm/delivery-control-plane",
        import.meta.url,
      ).pathname;
      const manifestPath = path.join(output, "delivery-control-plane.k8s.yaml");
      const archive = await stageChart(
        {
          name: "delivery-control-plane",
          chartDirectory,
          manifestPath,
          fingerprint: await fingerprintChart(chartDirectory, manifestPath),
        },
        "2.0.0-801",
        path.join(directory, active ? "active-stage" : "inactive-stage"),
      );
      const verifiedBytes = new Uint8Array(
        await Bun.file(archive).arrayBuffer(),
      );
      if (active)
        await expect(
          renderBootstrapControlPlane(verifiedBytes, image),
        ).resolves.toBeUndefined();
      else
        await expect(
          renderBootstrapControlPlane(verifiedBytes, image),
        ).rejects.toThrow("unique delivery host");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("actual root self-reference survives paused account prerequisite then selected API bootstrap", async () => {
  const app = new App();
  await createAppsChart(app);
  const chart = app.charts.find((candidate) => candidate.node.id === "apps");
  if (chart === undefined) throw new Error("Missing actual apps chart");
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
