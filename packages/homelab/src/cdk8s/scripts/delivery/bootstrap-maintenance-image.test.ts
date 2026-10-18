import { App } from "cdk8s";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { createWoodpeckerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/woodpecker.ts";
import { applyOrdinaryDeliveryImageBindings } from "@shepherdjerred/homelab/cdk8s/src/ordinary-delivery-image-bindings.ts";
import { fingerprintChart } from "homelab/scripts/helm/helm-release-core.ts";
import { stageChart } from "homelab/scripts/helm/helm-push.ts";
import { bindChartImageDependencies } from "homelab/scripts/helm/helm-delivery-publication.ts";
import {
  BootstrapApplicationSchema,
  BootstrapDescriptorSchema,
  bootstrapImageManifest,
} from "homelab/scripts/ci/bootstrap-selection.ts";
import {
  bootstrapImages,
  prepareBootstrapManifest,
} from "homelab/scripts/ci/bootstrap-publication.ts";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
const documents = (raw: string) =>
  parseAllDocuments(raw).map((doc) => doc.toJSON());
const indexed = (docs: unknown[]) =>
  Object.fromEntries(
    docs.map((doc) => {
      const identity = z
        .object({
          kind: z.string(),
          metadata: z.object({
            name: z.string(),
            namespace: z.string().optional(),
          }),
        })
        .parse(doc);
      return [
        `${identity.kind}/${identity.metadata.namespace ?? ""}/${identity.metadata.name}`,
        doc,
      ];
    }),
  );

const native = (name: string) =>
  BootstrapApplicationSchema.parse({
    metadata: {
      name,
      namespace: "argocd",
      uid: `fixture-${name}`,
      resourceVersion: "1",
    },
    spec: {
      source: {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: name,
        targetRevision: "2.0.0-1010900",
      },
    },
    status: {
      sync: { status: "Synced", revision: "2.0.0-1010900" },
      health: { status: "Healthy" },
    },
  });

async function fixture(directory: string) {
  const app = new App({ outdir: path.join(directory, "dist") });
  createWoodpeckerChart(app);
  applyOrdinaryDeliveryImageBindings(app);
  app.synth();
  const chartDirectory = new URL("../../helm/woodpecker", import.meta.url)
    .pathname;
  const manifestPath = path.join(app.outdir, "woodpecker.k8s.yaml");
  const input = {
    name: "woodpecker",
    chartDirectory,
    manifestPath,
    fingerprint: await fingerprintChart(chartDirectory, manifestPath),
  };
  const raw = await Bun.file(manifestPath).text();
  const recipeImage = z
    .string()
    .parse(
      documents(raw).find(
        (doc) =>
          doc.kind === "Deployment" &&
          doc.metadata.name === "temporal-maintenance-worker",
      ).spec.template.spec.containers[0].image,
    );
  const original = `docker.io/shepherdjerred/temporal-worker:2.0.0-1010880@${digest("f")}`;
  const baseline = bindChartImageDependencies(raw, {
    "shepherdjerred/temporal-worker": digest("f"),
    "shepherdjerred/woodpecker-config-extension": digest("d"),
  }).replaceAll(
    `docker.io/shepherdjerred/temporal-worker@${digest("f")}`,
    original,
  );
  const nativeDocuments = documents(baseline);
  const root = native("apps");
  const captured = {
    root,
    applications: [native("woodpecker")],
    priorRoot: JSON.stringify(root),
  };
  const sourceRevision = "a".repeat(40);
  const descriptor = BootstrapDescriptorSchema.parse({
    schema: "delivery-bootstrap/v1",
    sourceRevision,
    pullRequest: 1,
    revision: "2.0.0-1010907",
    requestId: "11111111-1111-4111-8111-111111111111",
    targets: ["woodpecker"],
    images: {
      woodpecker: {
        repository: "docker.io/shepherdjerred/woodpecker-config-extension",
        sourceRevision,
        version: "2.0.0-1010907",
        digest: digest("b"),
      },
      delivery: {
        repository: "docker.io/shepherdjerred/delivery",
        sourceRevision,
        version: "2.0.0-1010907",
        digest: digest("c"),
      },
    },
  });
  const manifests = nativeDocuments.map((doc) => JSON.stringify(doc));
  return {
    input,
    raw,
    recipeImage,
    original,
    baseline,
    nativeDocuments,
    captured,
    descriptor,
    manifests,
  };
}

test("actual frozen-input Woodpecker bootstrap preserves original maintenance images through Helm", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bootstrap-maintenance-"),
  );
  try {
    const data = await fixture(directory);
    const { input, raw, original, baseline, captured, descriptor, manifests } =
      data;
    expect(data.recipeImage).toContain(
      "Delivery requires image:temporal-worker",
    );
    const read = vi.fn(() => Promise.resolve({ manifests }));
    const bindings = await bootstrapImages(descriptor, captured, read);
    expect(read).toHaveBeenCalledWith(
      "/woodpecker/manifests?revision=2.0.0-1010900",
    );
    expect(bindings.maintenanceImage).toBe(original);
    const prepared = prepareBootstrapManifest(raw, "woodpecker", {
      descriptor,
      captured,
      bindings,
    });
    expect(indexed(documents(prepared))).toEqual(
      indexed(
        documents(bootstrapImageManifest(baseline, "woodpecker", descriptor)),
      ),
    );
    const manifestPath = path.join(directory, "prepared.yaml");
    await Bun.write(manifestPath, prepared);
    const baselinePath = path.join(directory, "baseline.yaml");
    await Bun.write(baselinePath, baseline);
    const priorArchive = await stageChart(
      { ...input, manifestPath: baselinePath },
      "2.0.0-1010900",
      path.join(directory, "baseline"),
    );
    const priorRender = Bun.spawnSync([
      "helm",
      "template",
      "woodpecker",
      priorArchive,
    ]);
    expect(priorRender.exitCode).toBe(0);
    const archive = await stageChart(
      { ...input, manifestPath },
      descriptor.revision,
      path.join(directory, "staged"),
    );
    const rendered = Bun.spawnSync(["helm", "template", "woodpecker", archive]);
    expect(rendered.exitCode).toBe(0);
    expect(indexed(documents(rendered.stdout.toString()))).toEqual(
      indexed(
        documents(
          bootstrapImageManifest(
            priorRender.stdout.toString(),
            "woodpecker",
            descriptor,
          ),
        ),
      ),
    );
    const maintenance = documents(rendered.stdout.toString()).find(
      (doc) =>
        doc.kind === "Deployment" &&
        doc.metadata.name === "temporal-maintenance-worker",
    );
    expect(maintenance.spec.template.spec.containers[0].image).toBe(original);
    expect(maintenance.spec.template.spec.initContainers[0].image).toBe(
      original,
    );
    const originalMaintenance = data.nativeDocuments.find(
      (doc) =>
        doc.kind === "Deployment" &&
        doc.metadata.name === "temporal-maintenance-worker",
    );
    const conflicting = structuredClone(originalMaintenance);
    conflicting.spec.template.spec.initContainers[0].image = `docker.io/shepherdjerred/temporal-worker@${digest("e")}`;
    await expect(
      bootstrapImages(descriptor, captured, () =>
        Promise.resolve({ manifests: [JSON.stringify(conflicting)] }),
      ),
    ).rejects.toThrow("init/runtime image differs");
    await expect(
      bootstrapImages(descriptor, captured, () =>
        Promise.resolve({
          manifests: [...manifests, JSON.stringify(originalMaintenance)],
        }),
      ),
    ).rejects.toThrow(z.ZodError);
    const extra = {
      kind: "ConfigMap",
      metadata: { name: "unexpected-image" },
      data: { image: data.recipeImage },
    };
    expect(() =>
      prepareBootstrapManifest(
        `${raw}\n---\n${JSON.stringify(extra)}`,
        "woodpecker",
        { descriptor, captured, bindings },
      ),
    ).toThrow("exactly its original maintenance");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
