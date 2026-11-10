import { beforeAll, describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { stringify } from "yaml";
import { z } from "zod";
import {
  chartObjectsOf,
  synthesizedCharts,
  type SynthesizedObject,
} from "@shepherdjerred/homelab/cdk8s/src/testing/synthesized-charts.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Rendered-manifest snapshots for one representative service of each shape:
 * first-party web services (tracker, trmnl-dashboard, alert-dashboard), a
 * first-party bot (birmel), and a LinuxServer app inside a shared namespace
 * chart (sonarr), each with its Argo Application.
 *
 * They exist to show the blast radius of a shared-construct change in review:
 * a refactor that claims to be output-identical must leave every file here
 * untouched, and a deliberate change shows up as a readable YAML diff.
 * `scripts/dist-equivalence.ts` is the whole-tree proof; these are the
 * permanent, reviewable sample.
 *
 * Regenerate with `bun run test -- src/testing/first-party-snapshots.test.ts --update`
 * and review the diff.
 */

const SNAPSHOTS = new URL("first-party-snapshots/", import.meta.url);

type SnapshotTarget = {
  /** Snapshot file stem. */
  name: string;
  /** Chart that renders the workload. */
  chart: string;
  /** Argo Application (in the `apps` chart) that deploys that chart. */
  application: string;
  /**
   * Object names to keep when the chart holds more than this service. Omitted
   * for a chart that is the service.
   */
  objects?: readonly string[];
};

const TARGETS: readonly SnapshotTarget[] = [
  { name: "tracker", chart: "tracker", application: "tracker" },
  {
    name: "trmnl-dashboard",
    chart: "trmnl-dashboard",
    application: "trmnl-dashboard",
  },
  {
    name: "alert-dashboard",
    chart: "alert-dashboard",
    application: "alert-dashboard",
  },
  { name: "birmel", chart: "birmel", application: "birmel" },
  {
    name: "sonarr",
    chart: "media",
    application: "media",
    objects: [
      "media-sonarr",
      "sonarr-pvc",
      "media-sonarr-service",
      "media-sonarr-tailscale-ingress-ingress",
    ],
  },
];

const catalogVersions = Object.entries(
  z.record(z.string(), z.string()).parse(versions),
);

/**
 * Replace a version-catalog pin with its catalog key, so a Renovate bump of
 * an upstream image does not churn these snapshots. A pin is recognised as
 * the `:<version>` suffix of an image reference; when several keys share the
 * value, the one named in the reference wins.
 */
function withoutCatalogPins(value: string): string {
  const matches = catalogVersions.filter(([, version]) =>
    value.endsWith(`:${version}`),
  );
  const match =
    matches.find(([key]) => value.includes(key.split("/").at(-1) ?? key)) ??
    matches[0];
  if (match === undefined) return value;
  const [key, version] = match;
  return `${value.slice(0, value.length - version.length)}<version-catalog:${key}>`;
}

function normalized(value: unknown): unknown {
  if (typeof value === "string") return withoutCatalogPins(value);
  if (Array.isArray(value)) return value.map((item) => normalized(item));
  return value !== null && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, normalized(child)]),
      )
    : value;
}

async function rendered(
  objects: readonly SynthesizedObject[],
  file: string,
): Promise<string> {
  const documents = objects
    .map((object) => stringify(normalized(object), { lineWidth: 0 }))
    .join("---\n");
  return prettier.format(documents, {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  });
}

let charts: Awaited<ReturnType<typeof synthesizedCharts>>;
beforeAll(async () => {
  charts = await synthesizedCharts();
});

describe("first-party rendered manifest snapshots", () => {
  test.each(TARGETS)("$name workload objects", async (target) => {
    const all = chartObjectsOf(charts, target.chart);
    const selected =
      target.objects === undefined
        ? all
        : target.objects.map((name) => {
            const found = all.filter((object) => object.metadata.name === name);
            expect(found, `${target.chart}/${name}`).toHaveLength(1);
            return found;
          });
    const file = fileURLToPath(new URL(`${target.name}.yaml`, SNAPSHOTS));
    await expect(await rendered(selected.flat(), file)).toMatchFileSnapshot(
      file,
    );
  });

  test.each(TARGETS)("$name Argo Application", async (target) => {
    const applications = chartObjectsOf(charts, "apps").filter(
      (object) =>
        object.kind === "Application" &&
        object.metadata.name === target.application,
    );
    expect(applications, target.application).toHaveLength(1);
    const file = fileURLToPath(
      new URL(`${target.name}.application.yaml`, SNAPSHOTS),
    );
    await expect(await rendered(applications, file)).toMatchFileSnapshot(file);
  });
});
