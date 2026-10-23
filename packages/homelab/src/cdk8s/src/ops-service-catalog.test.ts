import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import { setupCharts } from "./setup-charts.ts";
import { imageRegistry } from "@shepherdjerred/version-catalog/image-registry";
import { transitionRendering } from "./release-configuration.ts";
import { OPERATOR_RUN_DATA_APPLICATIONS } from "./resources/argo-applications/platform/delivery-rbac.ts";

const ApplicationSchema = z
  .object({
    apiVersion: z.string().startsWith("argoproj.io/"),
    kind: z.literal("Application"),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

/** Every ArgoCD Application the synthesized app renders, by name. */
async function renderedApplicationNames(): Promise<string[]> {
  const app = new App({ outdir: ".test-synth-ops-service-catalog" });
  await setupCharts(app);
  return app.charts
    .flatMap((chart) => z.array(z.unknown()).parse(chart.toJson()))
    .map((manifest) => ApplicationSchema.safeParse(manifest))
    .filter((result) => result.success)
    .map((result) => result.data.metadata.name);
}

const claimedApplications = SERVICE_CATALOG.services.flatMap(
  (service) => service.argoApps,
);

describe("ops service catalog drift", () => {
  it("claims every rendered ArgoCD Application exactly once", async () => {
    const rendered = await renderedApplicationNames();

    expect(rendered.length).toBeGreaterThan(0);
    expect(
      rendered.filter((name) => !claimedApplications.includes(name)),
    ).toEqual([]);
    expect(
      rendered.filter(
        (name) =>
          claimedApplications.filter((claimed) => claimed === name).length !==
          1,
      ),
    ).toEqual([]);
  });

  it("names only ArgoCD Applications that are rendered", async () => {
    const rendered = new Set(await renderedApplicationNames());
    const dormant = SERVICE_CATALOG.services.flatMap((service) =>
      service.argoApps.filter(
        (name) => service.rootReleaseExclusions?.[name] === "inactive",
      ),
    );
    // The operator-run data layers render only under transition rendering.
    const transitional: readonly string[] = transitionRendering()
      ? []
      : [...OPERATOR_RUN_DATA_APPLICATIONS];
    expect(transitional.filter((name) => rendered.has(name))).toEqual([]);
    // Planned Applications stay catalog-owned while credential-gated bootstrap
    // omits their resources. Every absence must be explicitly classified.
    expect(
      claimedApplications.filter(
        (name) => !rendered.has(name) && !dormant.includes(name),
      ),
    ).toEqual([]);
    expect(
      dormant
        .filter((name) => !rendered.has(name) && !transitional.includes(name))
        .sort(),
    ).toEqual([]);
  });

  it("declares registered primary images without requiring Git deployment pins", () => {
    const images = new Set(imageRegistry.images.map((entry) => entry.name));
    const missing = SERVICE_CATALOG.services
      .flatMap((service) => service.deploy)
      .map((variant) => variant.versionKey.split("/")[1])
      .filter((image) => image === undefined || !images.has(image));

    expect(missing).toEqual([]);
  });
});
