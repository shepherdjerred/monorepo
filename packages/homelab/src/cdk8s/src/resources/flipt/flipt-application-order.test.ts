import { App, Chart, Testing } from "cdk8s";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { applyApplicationReleasePolicy } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { createFliptApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/flipt.ts";
import { createTemporalApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/temporal.ts";

const ApplicationSchema = z.object({
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()),
  }),
});

describe("Flipt application ordering", () => {
  test("places Flipt before Temporal", () => {
    const app = new App();
    const chart = new Chart(app, "apps", {
      disableResourceNameHashes: true,
    });
    createFliptApp(chart);
    createTemporalApp(chart);
    applyApplicationReleasePolicy(app);

    const applications = z.array(ApplicationSchema).parse(Testing.synth(chart));
    const waves = new Map(
      applications.map((application) => [
        application.metadata.name,
        Number(
          application.metadata.annotations["argocd.argoproj.io/sync-wave"],
        ),
      ]),
    );

    const fliptWave = z.number().int().parse(waves.get("flipt"));
    const temporalWave = z.number().int().parse(waves.get("temporal"));
    expect(fliptWave).toBe(-18);
    expect(temporalWave).toBe(0);
    expect(fliptWave).toBeLessThan(temporalWave);
  });
});
