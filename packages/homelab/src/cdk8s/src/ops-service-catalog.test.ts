import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import { setupCharts } from "./setup-charts.ts";
import versions from "./versions.ts";

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

    expect(claimedApplications.filter((name) => !rendered.has(name))).toEqual(
      [],
    );
  });

  it("deploys from version catalog keys that exist", () => {
    const versionKeys = new Set(Object.keys(versions));
    const missing = SERVICE_CATALOG.services
      .flatMap((service) => service.deploy)
      .map((variant) => variant.versionKey)
      .filter((key) => !versionKeys.has(key));

    expect(missing).toEqual([]);
  });
});
