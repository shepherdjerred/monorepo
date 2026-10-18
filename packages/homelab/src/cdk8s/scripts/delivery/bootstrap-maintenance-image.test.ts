import { App } from "cdk8s";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { createWoodpeckerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/woodpecker.ts";
import { fingerprintChart } from "homelab/scripts/helm/helm-release-core.ts";
import { stageChart } from "homelab/scripts/helm/helm-push.ts";
import { BootstrapApplicationSchema } from "homelab/scripts/ci/bootstrap-selection.ts";
import {
  bootstrapMaintenanceImage,
  preserveBootstrapMaintenanceImage,
} from "homelab/scripts/ci/bootstrap-publication.ts";

test("actual catalog-based Woodpecker bootstrap preserves immutable original maintenance images through Helm", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bootstrap-maintenance-"),
  );
  try {
    const app = new App({ outdir: path.join(directory, "dist") });
    createWoodpeckerChart(app);
    app.synth();
    const chartDirectory = new URL("../../helm/woodpecker", import.meta.url)
      .pathname;
    const input = {
      name: "woodpecker",
      chartDirectory,
      manifestPath: path.join(app.outdir, "woodpecker.k8s.yaml"),
      fingerprint: await fingerprintChart(
        chartDirectory,
        path.join(app.outdir, "woodpecker.k8s.yaml"),
      ),
    };
    const raw = await Bun.file(input.manifestPath).text();
    const documents = parseAllDocuments(raw).map((doc) => doc.toJSON());
    const maintenance = documents.find(
      (doc) =>
        doc.kind === "Deployment" &&
        doc.metadata.name === "temporal-maintenance-worker",
    );
    const original = `docker.io/shepherdjerred/temporal-worker:2.0.0-1010880@sha256:${"f".repeat(64)}`;
    const catalogImage = z
      .string()
      .parse(maintenance.spec.template.spec.containers[0].image);
    expect(catalogImage).not.toBe(original);
    const prior = structuredClone(maintenance);
    prior.spec.template.spec.containers[0].image = original;
    prior.spec.template.spec.initContainers[0].image = original;
    const read = vi.fn(() =>
      Promise.resolve({ manifests: [JSON.stringify(prior)] }),
    );
    const captured = BootstrapApplicationSchema.parse({
      metadata: {
        name: "woodpecker",
        namespace: "argocd",
        uid: "original-uid",
        resourceVersion: "1",
      },
      spec: {
        source: {
          repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
          chart: "woodpecker",
          targetRevision: "2.0.0-1010900",
        },
      },
      status: {
        sync: { status: "Synced", revision: "2.0.0-1010900" },
        health: { status: "Healthy" },
      },
    });
    const observed = await bootstrapMaintenanceImage(captured, read);
    expect(read).toHaveBeenCalledWith(
      "/woodpecker/manifests?revision=2.0.0-1010900",
    );
    expect(observed).toBe(original);
    const prepared = preserveBootstrapMaintenanceImage(raw, observed);
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
    const expected = indexed(
      documents.map((doc) => (doc === maintenance ? prior : doc)),
    );
    expect(
      indexed(parseAllDocuments(prepared).map((doc) => doc.toJSON())),
    ).toEqual(expected);
    const manifestPath = path.join(directory, "prepared.yaml");
    await Bun.write(manifestPath, prepared);
    const baseline = await stageChart(
      input,
      "2.0.0-1010900",
      path.join(directory, "baseline"),
    );
    const priorRender = Bun.spawnSync([
      "helm",
      "template",
      "woodpecker",
      baseline,
    ]);
    expect(priorRender.exitCode).toBe(0);
    const priorRendered = parseAllDocuments(priorRender.stdout.toString()).map(
      (doc) => doc.toJSON(),
    );
    const archive = await stageChart(
      { ...input, manifestPath },
      "2.0.0-1010907",
      path.join(directory, "staged"),
    );
    const rendered = Bun.spawnSync(["helm", "template", "woodpecker", archive]);
    expect(rendered.exitCode).toBe(0);
    expect(
      indexed(
        parseAllDocuments(rendered.stdout.toString()).map((doc) =>
          doc.toJSON(),
        ),
      ),
    ).toEqual(
      indexed(
        priorRendered.map((doc) =>
          doc.kind === "Deployment" &&
          doc.metadata.name === "temporal-maintenance-worker"
            ? prior
            : doc,
        ),
      ),
    );
    const conflicting = structuredClone(prior);
    conflicting.spec.template.spec.initContainers[0].image =
      maintenance.spec.template.spec.initContainers[0].image;
    await expect(
      bootstrapMaintenanceImage(captured, () =>
        Promise.resolve({ manifests: [JSON.stringify(conflicting)] }),
      ),
    ).rejects.toThrow("init/runtime image differs");
    await expect(
      bootstrapMaintenanceImage(captured, () =>
        Promise.resolve({
          manifests: [JSON.stringify(prior), JSON.stringify(prior)],
        }),
      ),
    ).rejects.toThrow(z.ZodError);
    expect(() =>
      preserveBootstrapMaintenanceImage(`${raw}\n# ${catalogImage}`, original),
    ).toThrow("exactly its original maintenance");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
