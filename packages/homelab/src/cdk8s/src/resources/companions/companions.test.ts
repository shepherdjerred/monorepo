import { beforeAll, describe, expect, test, vi } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import type * as ReleaseConfiguration from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import {
  BASELINE_CHART_APPLICATIONS,
  ROOT_CHART,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import {
  COMPANION_APPLICATIONS,
  companionChartName,
} from "@shepherdjerred/homelab/cdk8s/src/resources/companions/names.ts";

/**
 * The window turns transition rendering on; this renders that state and
 * proves each companion chart re-renders its root objects byte for byte, so
 * its Application adopts them without a change once the root is orphaned.
 */
vi.mock(
  "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts",
  async (importOriginal) => ({
    ...(await importOriginal<typeof ReleaseConfiguration>()),
    transitionRendering: () => true,
  }),
);

const ManifestSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string().optional(),
  }),
  spec: z.unknown().optional(),
});
type Manifest = z.infer<typeof ManifestSchema>;
const ApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({ destination: z.object({ namespace: z.string() }) }),
});

function identity(manifest: Manifest): string {
  return `${manifest.apiVersion}/${manifest.kind}/${manifest.metadata.namespace ?? ""}/${manifest.metadata.name}`;
}

let charts: Map<string, Manifest[]>;
beforeAll(async () => {
  const app = new App({ outdir: ".test-synth-companions" });
  await setupCharts(app);
  // Compare the objects as synthesis publishes them, lazily built specs included.
  app.synthYaml();
  charts = new Map(
    app.charts.map((chart) => [
      chart.node.id,
      z.array(ManifestSchema).parse(chart.toJson()),
    ]),
  );
});

function chartObjects(id: string): Manifest[] {
  const objects = charts.get(id);
  if (objects === undefined) throw new Error(`Chart ${id} was not rendered`);
  return objects;
}

describe("companion charts under transition rendering", () => {
  test("each companion object is byte-identical to the root object it adopts", () => {
    const root = new Map(
      chartObjects(ROOT_CHART).map((manifest) => [
        identity(manifest),
        manifest,
      ]),
    );
    for (const application of COMPANION_APPLICATIONS) {
      const objects = chartObjects(companionChartName(application));
      expect(objects.length, application).toBeGreaterThan(0);
      for (const manifest of objects)
        expect(manifest, identity(manifest)).toStrictEqual(
          root.get(identity(manifest)),
        );
    }
  });

  test("each companion stays inside its Application's destination namespace", () => {
    const destinations = new Map(
      chartObjects(ROOT_CHART)
        .map((manifest) => ApplicationSchema.safeParse(manifest))
        .filter((result) => result.success)
        .map((result) => [
          result.data.metadata.name,
          result.data.spec.destination.namespace,
        ]),
    );
    for (const application of COMPANION_APPLICATIONS) {
      const namespace = destinations.get(application);
      expect(namespace, application).toBeDefined();
      for (const manifest of chartObjects(companionChartName(application)))
        expect(manifest.metadata.namespace, identity(manifest)).toBe(namespace);
    }
  });

  test("every root object other than Applications and AppProjects has a post-window owner", () => {
    const owned = new Set(
      [
        ...BASELINE_CHART_APPLICATIONS,
        ...COMPANION_APPLICATIONS.map((application) =>
          companionChartName(application),
        ),
      ].flatMap((id) => chartObjects(id).map((manifest) => identity(manifest))),
    );
    const orphaned = chartObjects(ROOT_CHART)
      .filter(
        (manifest) =>
          manifest.kind !== "Application" && manifest.kind !== "AppProject",
      )
      .map((manifest) => identity(manifest))
      .filter((key) => !owned.has(key));
    expect(orphaned).toEqual([]);
  });

  test("companions own disjoint objects", () => {
    const seen = new Map<string, string>();
    for (const application of COMPANION_APPLICATIONS)
      for (const manifest of chartObjects(companionChartName(application))) {
        const key = identity(manifest);
        expect(seen.get(key), key).toBeUndefined();
        seen.set(key, application);
      }
  });
});
