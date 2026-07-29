import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  assertReleaseNotStale,
  discoverChartInputs,
  fingerprintChart,
  latestPublishedVersion,
  planCharts,
  plannedChartRevision,
  verifyRecordedFingerprint,
  type ChartInput,
} from "./helm-release-core.ts";

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "helm-release-"));
  await Bun.write(
    path.join(directory, "helm/apps/Chart.yaml"),
    'apiVersion: v2\nname: apps\nversion: "$version"\nappVersion: "$appVersion"\n',
  );
  await Bun.write(
    path.join(directory, "helm/worker/Chart.yaml"),
    'apiVersion: v2\nname: worker\nversion: "$version"\nappVersion: "$appVersion"\n',
  );
  await Bun.write(path.join(directory, "dist/apps.k8s.yaml"), "kind: List\n");
  await Bun.write(
    path.join(directory, "dist/worker.k8s.yaml"),
    "kind: Deployment\n",
  );
  return directory;
}

describe("discoverChartInputs", () => {
  test("requires a manifest for every chart", async () => {
    const directory = await fixture();
    try {
      await rm(path.join(directory, "dist/worker.k8s.yaml"));
      await expect(
        discoverChartInputs(
          path.join(directory, "helm"),
          path.join(directory, "dist"),
        ),
      ).rejects.toThrow("worker");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("ignores generated build versions in the fingerprint", async () => {
    const directory = await fixture();
    try {
      const first = await discoverChartInputs(
        path.join(directory, "helm"),
        path.join(directory, "dist"),
      );
      const chartYaml = path.join(directory, "helm/worker/Chart.yaml");
      await Bun.write(
        chartYaml,
        'apiVersion: v2\nname: worker\nversion: "$version"\nappVersion: "$appVersion"\n',
      );
      const second = await discoverChartInputs(
        path.join(directory, "helm"),
        path.join(directory, "dist"),
      );
      expect(second).toEqual(first);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("includes non-generated template files in the fingerprint", async () => {
    const directory = await fixture();
    try {
      const helperPath = path.join(
        directory,
        "helm/worker/templates/_helpers.tpl",
      );
      await Bun.write(
        helperPath,
        '{{- define "worker.name" -}}worker{{- end -}}',
      );
      const chartDirectory = path.join(directory, "helm/worker");
      const manifestPath = path.join(directory, "dist/worker.k8s.yaml");
      const first = await fingerprintChart(chartDirectory, manifestPath);
      await Bun.write(
        helperPath,
        '{{- define "worker.name" -}}changed{{- end -}}',
      );
      expect(await fingerprintChart(chartDirectory, manifestPath)).not.toBe(
        first,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("normalizes the generated fingerprint metadata after packaging", async () => {
    const directory = await fixture();
    try {
      const chartDirectory = path.join(directory, "helm/worker");
      const manifestPath = path.join(directory, "dist/worker.k8s.yaml");
      const original = await fingerprintChart(chartDirectory, manifestPath);
      const generatedTemplate = path.join(
        chartDirectory,
        "templates/worker.k8s.yaml",
      );
      await Bun.write(generatedTemplate, Bun.file(manifestPath));
      const chartYamlPath = path.join(chartDirectory, "Chart.yaml");
      const chartYaml = await Bun.file(chartYamlPath).text();
      await Bun.write(
        chartYamlPath,
        `${chartYaml
          .replace(/^version:.*$/m, 'version: "2.0.0-42"')
          .replace(/^appVersion:.*$/m, 'appVersion: "2.0.0-42"')
          .trimEnd()}\nannotations:\n  ci.sjer.red/content-fingerprint: "${original}"\n`,
      );
      expect(await fingerprintChart(chartDirectory, generatedTemplate)).toBe(
        original,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("verifyRecordedFingerprint rejects inconsistent chart metadata", () => {
  expect(() =>
    verifyRecordedFingerprint("worker", "sha256:recorded", "sha256:actual"),
  ).toThrow(
    "worker: published content fingerprint mismatch: recorded sha256:recorded, actual sha256:actual",
  );
});

test("assertReleaseNotStale rejects an older concurrent build", () => {
  expect(() =>
    assertReleaseNotStale(
      20,
      new Map([["worker", { version: "2.0.0-21", fingerprint: "sha256:new" }]]),
    ),
  ).toThrow("Refusing stale Helm release 20");
});

describe("planCharts", () => {
  const inputs: ChartInput[] = [
    {
      name: "apps",
      chartDirectory: "/apps",
      manifestPath: "/apps.yaml",
      fingerprint: "sha256:apps",
    },
    {
      name: "worker",
      chartDirectory: "/worker",
      manifestPath: "/worker.yaml",
      fingerprint: "sha256:new",
    },
  ];

  test("is a zero-chart no-op when published content matches", () => {
    const published = new Map([
      ["apps", { version: "2.0.0-9", fingerprint: "sha256:apps" }],
      ["worker", { version: "2.0.0-9", fingerprint: "sha256:new" }],
    ]);
    expect(planCharts(inputs, published).publishOrder).toEqual([]);
  });

  test("publishes changed leaves before the coordinating apps chart", () => {
    const published = new Map([
      ["apps", { version: "2.0.0-9", fingerprint: "sha256:apps" }],
      ["worker", { version: "2.0.0-9", fingerprint: "sha256:old" }],
    ]);
    const plan = planCharts(inputs, published);
    expect(plan.publishOrder).toEqual(["worker", "apps"]);
    expect(plannedChartRevision("apps", plan, "2.0.0-10")).toBe("2.0.0-10");
  });

  test("retains the exact published apps revision on a content no-op", () => {
    const published = new Map([
      ["apps", { version: "2.0.0-9", fingerprint: "sha256:apps" }],
      ["worker", { version: "2.0.0-9", fingerprint: "sha256:new" }],
    ]);
    expect(
      plannedChartRevision("apps", planCharts(inputs, published), "2.0.0-10"),
    ).toBe("2.0.0-9");
  });
});

test("latestPublishedVersion includes red or canceled producers", () => {
  expect(
    latestPublishedVersion([
      { version: "2.0.0-19", urls: ["charts/worker-2.0.0-19.tgz"] },
      { version: "2.0.0-21", urls: ["charts/worker-2.0.0-21.tgz"] },
      { version: "1.0.0", urls: ["charts/worker-1.0.0.tgz"] },
    ]),
  ).toEqual({
    version: "2.0.0-21",
    url: "charts/worker-2.0.0-21.tgz",
  });
});
