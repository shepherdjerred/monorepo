import { beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type * as ReleaseConfiguration from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import {
  BASELINE_CHART_APPLICATIONS,
  ROOT_CHART,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import {
  COMPANION_APPLICATIONS,
  COMPANION_CHARTS,
  companionChartName,
  FOLLOWING_COMPANIONS,
} from "@shepherdjerred/homelab/cdk8s/src/resources/companions/names.ts";
import { dormantCharts } from "@shepherdjerred/homelab/cdk8s/src/resources/companions/dormant.ts";
import {
  chartObjectsOf,
  objectIdentity as identity,
  type SynthesizedObject,
  synthesizedCharts,
} from "@shepherdjerred/homelab/cdk8s/src/testing/synthesized-charts.ts";

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

const ApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({ destination: z.object({ namespace: z.string() }) }),
});

let charts: ReadonlyMap<string, SynthesizedObject[]>;
beforeAll(async () => {
  charts = await synthesizedCharts();
});

function chartObjects(id: string): SynthesizedObject[] {
  return chartObjectsOf(charts, id);
}

describe("companion charts under transition rendering", () => {
  test("each companion object is byte-identical to the root object it adopts", () => {
    const root = new Map(
      chartObjects(ROOT_CHART).map((manifest) => [
        identity(manifest),
        manifest,
      ]),
    );
    for (const name of COMPANION_CHARTS) {
      const objects = chartObjects(name);
      expect(objects.length, name).toBeGreaterThan(0);
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
    for (const manifest of chartObjects("velero-schedules"))
      expect(manifest.metadata.namespace, identity(manifest)).toBe(
        destinations.get("velero"),
      );
  });

  test("Kueue's flavors, priority classes and queues follow Kueue, out of cluster-platform", () => {
    const kueueObjects = (id: string) =>
      chartObjects(id).filter((manifest) =>
        manifest.apiVersion.startsWith("kueue.x-k8s.io/"),
      );
    const queues = chartObjects(FOLLOWING_COMPANIONS["kueue"] ?? "");
    expect(queues.map((manifest) => identity(manifest)).sort()).toEqual(
      kueueObjects(ROOT_CHART)
        .map((manifest) => identity(manifest))
        .sort(),
    );
    expect(new Set(queues.map((manifest) => manifest.kind))).toEqual(
      new Set([
        "ResourceFlavor",
        "WorkloadPriorityClass",
        "ClusterQueue",
        "LocalQueue",
      ]),
    );
    expect(kueueObjects("cluster-platform")).toEqual([]);
  });

  test("ArgoCD's TunnelBinding follows cloudflare-operator, so ArgoCD needs no tunnel CRD", () => {
    expect(FOLLOWING_COMPANIONS["cloudflare-operator"]).toBe("argocd-tunnel");
    const tunnel = chartObjects("argocd-tunnel");
    expect(tunnel.map((manifest) => manifest.kind)).toEqual(["TunnelBinding"]);
    expect(tunnel[0]?.metadata.namespace).toBe("argocd");
    expect(
      chartObjects("argocd-companion").filter(
        (manifest) => manifest.kind === "TunnelBinding",
      ),
    ).toEqual([]);
  });

  test("every root object other than Applications has a post-window owner", () => {
    const owned = new Set(
      [...BASELINE_CHART_APPLICATIONS, ...COMPANION_CHARTS].flatMap((id) =>
        chartObjects(id).map((manifest) => identity(manifest)),
      ),
    );
    const orphaned = chartObjects(ROOT_CHART)
      .filter((manifest) => manifest.kind !== "Application")
      .map((manifest) => identity(manifest))
      .filter((key) => !owned.has(key));
    expect(orphaned).toEqual([]);
  });

  test("each companion has a Helm shell that is dormant only while the switch is off", async () => {
    expect(dormantCharts(true)).toEqual(new Set());
    expect(dormantCharts(false)).toEqual(COMPANION_CHARTS);
    for (const name of COMPANION_CHARTS) {
      const shell = await Bun.file(
        new URL(`../../../helm/${name}/Chart.yaml`, import.meta.url),
      ).text();
      expect(shell, name).toContain(`name: ${name}\n`);
    }
  });

  test("companions own disjoint objects", () => {
    const seen = new Map<string, string>();
    for (const name of COMPANION_CHARTS)
      for (const manifest of chartObjects(name)) {
        const key = identity(manifest);
        expect(seen.get(key), key).toBeUndefined();
        seen.set(key, name);
      }
  });

  test("Velero's Schedules follow it, byte-identical, and its leading companion keeps only the credentials", () => {
    expect(
      chartObjects("velero-companion").map((manifest) => manifest.kind),
    ).toEqual(["OnePasswordItem"]);
    const schedules = chartObjects("velero-schedules");
    expect(new Set(schedules.map((manifest) => manifest.kind))).toEqual(
      new Set(["Schedule"]),
    );
    expect(schedules.map((manifest) => identity(manifest)).sort()).toEqual(
      chartObjects(ROOT_CHART)
        .filter((manifest) => manifest.kind === "Schedule")
        .map((manifest) => identity(manifest))
        .sort(),
    );
  });

  test("the argocd companion owns the three AppProjects every Application names", () => {
    expect(
      chartObjects("argocd-companion")
        .filter((manifest) => manifest.kind === "AppProject")
        .map((manifest) => manifest.metadata.name)
        .sort(),
    ).toEqual(["cluster", "default", "workloads"]);
  });
});
