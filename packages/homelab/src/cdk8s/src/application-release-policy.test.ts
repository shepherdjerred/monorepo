import { describe, expect, test } from "bun:test";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import {
  APPLICATION_LIFECYCLE_ANNOTATION,
  APPLICATION_RESOURCES_FINALIZER,
  applyApplicationReleasePolicy,
} from "./application-release-policy.ts";

const ManifestSchema = z.object({
  metadata: z.object({
    annotations: z.record(z.string(), z.string()),
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
    const chart = new Chart(app, "test");
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
    expect(workerManifest.spec.syncPolicy?.automated).toBeUndefined();

    const rootManifest = ManifestSchema.parse(root.toJson());
    expect(
      rootManifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
    ).toBe("retain");
    expect(rootManifest.metadata.finalizers).toBeUndefined();
    expect(rootManifest.spec.syncPolicy?.automated).toBeUndefined();
  });
});
