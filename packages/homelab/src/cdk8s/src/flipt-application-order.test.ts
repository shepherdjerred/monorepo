import { App, Chart, Testing } from "cdk8s";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createFliptApp } from "./resources/argo-applications/flipt.ts";
import { createTemporalApp } from "./resources/argo-applications/temporal.ts";

const ApplicationSchema = z.object({
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()),
  }),
});

describe("Flipt application ordering", () => {
  test("places Flipt before Temporal", () => {
    const app = new App();
    const chart = new Chart(app, "applications", {
      disableResourceNameHashes: true,
    });
    createFliptApp(chart);
    createTemporalApp(chart);

    const applications = z.array(ApplicationSchema).parse(Testing.synth(chart));
    const waves = new Map(
      applications.map((application) => [
        application.metadata.name,
        Number(
          application.metadata.annotations["argocd.argoproj.io/sync-wave"],
        ),
      ]),
    );

    expect(waves.get("flipt")).toBe(-2);
    expect(waves.get("temporal")).toBe(-1);
    expect(waves.get("flipt")).toBeLessThan(waves.get("temporal") ?? -1);
  });
});
