import { App } from "cdk8s";
import { beforeAll, expect, test, vi } from "vitest";
import type * as ReleaseConfiguration from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import { walkStrings } from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-applications.ts";
import { chartImageParameters } from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-values.ts";
import { chartImageInputs } from "homelab/scripts/helm/helm-delivery-publication.ts";

// The catalog flag flips at window step 8, after transition rendering is on.
vi.mock(
  "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts",
  async (importOriginal) => ({
    ...(await importOriginal<typeof ReleaseConfiguration>()),
    transitionRendering: () => true,
  }),
);

const FIRST_PARTY_DIGEST =
  /(?:shepherdjerred\/[a-z0-9-]+(?:\/[a-z0-9-]+)?|selected)@sha256:[a-f0-9]{64}/u;
const DEPENDENCY =
  /\(get \(get \(\.Values\.delivery \| default dict\) "dependencies" \| default dict\) "([a-z0-9.-]+)"\)/gu;

async function unexpected(): Promise<Record<string, string>> {
  throw new Error("The v2 catalog freezes no producer image");
}

let app: App;
beforeAll(async () => {
  app = new App({ outdir: ".test-synth-catalog-values" });
  await setupCharts(app);
});

test("with the catalog flag on, helm-push resolves and freezes no producer image", async () => {
  await expect(
    chartImageInputs({ dryRun: false, catalogV2: true }, unexpected),
  ).resolves.toBeUndefined();
  const images = { "shepherdjerred/arcade": `sha256:${"a".repeat(64)}` };
  await expect(
    chartImageInputs({ dryRun: false, catalogV2: false }, () =>
      Promise.resolve(images),
    ),
  ).resolves.toEqual(images);
  expect(Bun.env["HOMELAB_IMAGE_DIGESTS_JSON"]).toBeUndefined();
});

test("with the catalog flag on, no chart carries a first-party image digest and each Delivery dependency is a recipe parameter", () => {
  const dependent: string[] = [];
  for (const chart of app.charts) {
    const digests: string[] = [];
    const dependencies = new Set<string>();
    walkStrings(chart.toJson(), [], (text) => {
      if (FIRST_PARTY_DIGEST.test(text)) digests.push(text);
      for (const [, name = ""] of text.matchAll(DEPENDENCY))
        dependencies.add(name);
    });
    expect({ chart: chart.node.id, digests }).toEqual({
      chart: chart.node.id,
      digests: [],
    });
    if (dependencies.size === 0) continue;
    dependent.push(chart.node.id);
    const parameters = chartImageParameters(app, chart.node.id, "image:own");
    for (const name of dependencies)
      expect(parameters[`delivery.dependencies.${name}`]?.component).toMatch(
        /^image:/u,
      );
  }
  expect(dependent.length).toBeGreaterThan(0);
});
