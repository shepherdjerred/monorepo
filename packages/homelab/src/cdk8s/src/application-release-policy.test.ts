import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_LIFECYCLE_ANNOTATION,
  APPLICATION_RESOURCES_FINALIZER,
  MANAGED_APPLICATION_LABEL,
  applyApplicationReleasePolicy,
} from "./application-release-policy.ts";

const ManifestSchema = z.object({
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()),
    labels: z.record(z.string(), z.string()).optional(),
    finalizers: z.array(z.string()).optional(),
  }),
  spec: z.object({
    syncPolicy: z
      .object({
        automated: z.unknown().optional(),
      })
      .optional(),
  }),
});

function application(chart: Chart, name: string): Application {
  return new Application(chart, `${name}-construct`, {
    metadata: { name },
    spec: {
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.sjer.red",
        targetRevision: "1.0.0",
        chart: name,
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "default",
      },
      syncPolicy: { automated: {} },
    },
  });
}

describe("applyApplicationReleasePolicy", () => {
  test("adds cascading finalizers and explicit retain exceptions", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    const worker = application(chart, "worker");
    const root = application(chart, "apps");
    applyApplicationReleasePolicy(app);

    const workerManifest = ManifestSchema.parse(worker.toJson());
    expect(
      workerManifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
    ).toBe("cascade");
    expect(workerManifest.metadata.finalizers).toEqual([
      APPLICATION_RESOURCES_FINALIZER,
    ]);
    expect(workerManifest.metadata.labels?.[MANAGED_APPLICATION_LABEL]).toBe(
      "true",
    );
    expect(
      workerManifest.metadata.annotations[ARGOCD_SYNC_WAVE_ANNOTATION],
    ).toBe("4");
    expect(workerManifest.spec.syncPolicy?.automated).toEqual({
      enabled: false,
    });

    const rootManifest = ManifestSchema.parse(root.toJson());
    expect(
      rootManifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
    ).toBe("retain");
    expect(rootManifest.metadata.finalizers).toBeUndefined();
    expect(
      rootManifest.metadata.labels?.[MANAGED_APPLICATION_LABEL],
    ).toBeUndefined();
    expect(rootManifest.metadata.annotations[ARGOCD_SYNC_WAVE_ANNOTATION]).toBe(
      "0",
    );
    expect(rootManifest.spec.syncPolicy?.automated).toEqual({
      enabled: false,
    });
  });

  test("orders providers, controllers, dependencies, and leaf Applications", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    const expectedWaves = new Map([
      ["1password", "-20"],
      ["argocd", "-18"],
      ["tailscale", "-18"],
      ["temporal", "-17"],
      ["kueue", "1"],
      ["buildkite", "3"],
      ["worker", "4"],
    ]);
    const applications = [...expectedWaves.keys()].map((name) =>
      application(chart, name),
    );

    applyApplicationReleasePolicy(app);

    for (const resource of applications) {
      const manifest = ManifestSchema.parse(resource.toJson());
      expect(manifest.metadata.annotations[ARGOCD_SYNC_WAVE_ANNOTATION]).toBe(
        expectedWaves.get(manifest.metadata.name),
      );
    }
  });
});
