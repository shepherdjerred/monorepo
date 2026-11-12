import { App, Chart } from "cdk8s";
import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  HelmChartName,
  HelmValuesForChart,
} from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import {
  argoApplication,
  createFirstPartyApplication,
  helmApplication,
  type ArgoApplicationOptions,
  type HelmApplicationOptions,
} from "./application.ts";

function chart(): Chart {
  return new Chart(new App(), "test");
}

const AUTOMATED = {
  automated: { enabled: true },
  syncOptions: ["CreateNamespace=true"],
};

describe("helmApplication", () => {
  test("renders the body a hand-written upstream Application rendered", () => {
    const scope = chart();
    const application = helmApplication(scope, {
      name: "promtail",
      namespace: "promtail",
      chart: "promtail",
      repoUrl: "https://grafana.github.io/helm-charts",
      targetRevision: "6.17.1",
      valuesObject: { resources: { requests: { cpu: "100m" } } },
      syncPolicy: AUTOMATED,
    });

    expect(application.node.id).toBe("promtail-app");
    expect(scope.toJson()).toEqual([
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "promtail" },
        spec: {
          destination: {
            namespace: "promtail",
            server: "https://kubernetes.default.svc",
          },
          project: "cluster",
          revisionHistoryLimit: 5,
          source: {
            chart: "promtail",
            helm: {
              valuesObject: { resources: { requests: { cpu: "100m" } } },
            },
            repoURL: "https://grafana.github.io/helm-charts",
            targetRevision: "6.17.1",
          },
          syncPolicy: AUTOMATED,
        },
      },
    ]);
  });

  test("renders no helm block for a chart installed with its defaults", () => {
    const application = helmApplication(chart(), {
      name: "intel-device-plugin-operator",
      id: "intel-plugins-app",
      namespace: "intel-device-plugin-operator",
      chart: "intel-device-plugins-operator",
      repoUrl: "https://intel.github.io/helm-charts/",
      targetRevision: "0.34.0",
      syncPolicy: AUTOMATED,
    });

    expect(application.node.id).toBe("intel-plugins-app");
    expect(application.toJson().spec.source).toEqual({
      chart: "intel-device-plugins-operator",
      repoURL: "https://intel.github.io/helm-charts/",
      targetRevision: "0.34.0",
    });
  });

  test("carries a release name beside the values", () => {
    const application = helmApplication(chart(), {
      name: "velero",
      namespace: "velero",
      chart: "velero",
      repoUrl: "https://vmware-tanzu.github.io/helm-charts",
      targetRevision: "11.0.0",
      valuesObject: { snapshotsEnabled: false },
      helm: { releaseName: "velero" },
      syncPolicy: AUTOMATED,
    });

    expect(application.toJson().spec.source.helm).toEqual({
      releaseName: "velero",
      valuesObject: { snapshotsEnabled: false },
    });
  });

  test("renders values the generated type cannot express, unchecked", () => {
    const application = helmApplication(chart(), {
      name: "loki",
      namespace: "loki",
      chart: "loki",
      repoUrl: "https://grafana.github.io/helm-charts",
      targetRevision: "6.0.0",
      uncheckedValuesObject: { notInTheGeneratedType: true },
      syncPolicy: AUTOMATED,
    });

    expect(application.toJson().spec.source.helm).toEqual({
      valuesObject: { notInTheGeneratedType: true },
    });
    expect(() =>
      helmApplication(chart(), {
        name: "loki",
        namespace: "loki",
        chart: "loki",
        repoUrl: "https://grafana.github.io/helm-charts",
        targetRevision: "6.0.0",
        valuesObject: {},
        uncheckedValuesObject: {},
        syncPolicy: AUTOMATED,
      }),
    ).toThrow("both valuesObject and uncheckedValuesObject");
  });

  test("renders exactly the sync policy it was given", () => {
    const policies = [
      { automated: {} },
      { automated: { enabled: true } },
      { automated: { enabled: true, prune: true, selfHeal: true } },
      { automated: { enabled: false }, syncOptions: ["ServerSideApply=true"] },
    ];
    for (const syncPolicy of policies) {
      const application = helmApplication(chart(), {
        name: "loki",
        namespace: "loki",
        chart: "loki",
        repoUrl: "https://grafana.github.io/helm-charts",
        targetRevision: "6.0.0",
        syncPolicy,
      });
      expect(application.toJson().spec.syncPolicy).toEqual(syncPolicy);
    }
  });

  test("checks values against the chart being installed", () => {
    expectTypeOf<
      Required<HelmApplicationOptions<"loki">>["valuesObject"]
    >().toEqualTypeOf<HelmValuesForChart<"loki">>();
    expectTypeOf<
      Required<HelmApplicationOptions<"velero">>["valuesObject"]
    >().toEqualTypeOf<HelmValuesForChart<"velero">>();
    expectTypeOf<{ snapshotsEnabled: boolean }>().not.toExtend<
      HelmValuesForChart<"loki">
    >();
  });

  test("accepts only charts with generated values types", () => {
    expectTypeOf<
      Parameters<typeof helmApplication>[1]["chart"]
    >().toEqualTypeOf<HelmChartName>();
    expectTypeOf<"no-such-chart">().not.toExtend<HelmChartName>();
  });

  test("has no default sync policy", () => {
    type WithoutSyncPolicy = Omit<ArgoApplicationOptions, "syncPolicy">;
    expectTypeOf<WithoutSyncPolicy>().not.toExtend<ArgoApplicationOptions>();
  });
});

describe("createFirstPartyApplication", () => {
  test("renders the body a hand-written wrapper Application rendered", () => {
    const scope = chart();
    const application = createFirstPartyApplication(scope, {
      name: "tracker",
      namespace: "tracker",
      syncPolicy: AUTOMATED,
    });

    expect(application.node.id).toBe("tracker-app");
    expect(scope.toJson()).toEqual([
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "tracker" },
        spec: {
          destination: {
            namespace: "tracker",
            server: "https://kubernetes.default.svc",
          },
          project: "workloads",
          revisionHistoryLimit: 5,
          source: {
            chart: "tracker",
            repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
            targetRevision: "~2.0.0-0",
          },
          syncPolicy: AUTOMATED,
        },
      },
    ]);
  });

  test("renders no sync policy when given none", () => {
    const application = createFirstPartyApplication(chart(), {
      name: "delivery-data",
      namespace: "delivery",
      syncPolicy: undefined,
    });

    expect(application.toJson().spec).not.toHaveProperty("syncPolicy");
  });

  test("accepts a pinned revision, annotations and ignored differences", () => {
    const ignoreDifferences = [
      { group: "batch", kind: "Job", jsonPointers: ["/spec/template"] },
    ];
    const application = createFirstPartyApplication(chart(), {
      name: "apps",
      namespace: "argocd",
      targetRevision: "{{ .Chart.Version }}",
      metadata: {
        annotations: { "argocd.argoproj.io/ignore-healthcheck": "true" },
      },
      ignoreDifferences,
      syncPolicy: AUTOMATED,
    });
    const manifest = application.toJson();

    expect(manifest.metadata).toEqual({
      name: "apps",
      annotations: { "argocd.argoproj.io/ignore-healthcheck": "true" },
    });
    expect(manifest.spec.source.targetRevision).toBe("{{ .Chart.Version }}");
    expect(manifest.spec.ignoreDifferences).toEqual(ignoreDifferences);
  });
});

describe("argoApplication", () => {
  test("renders a source that is not a Helm chart", () => {
    const source = {
      repoUrl: "https://github.com/adyanth/cloudflare-operator.git",
      targetRevision: "v0.13.1",
      path: "config/default",
    };
    const application = argoApplication(chart(), {
      name: "cloudflare-operator",
      namespace: "cloudflare-operator-system",
      source,
      syncPolicy: { automated: { enabled: true } },
    });

    expect(application.toJson().spec.source).toEqual({
      repoURL: "https://github.com/adyanth/cloudflare-operator.git",
      targetRevision: "v0.13.1",
      path: "config/default",
    });
  });

  test("leaves the history limit unset on request", () => {
    const application = argoApplication(chart(), {
      name: "tracker",
      namespace: "tracker",
      source: { repoUrl: "https://example.invalid", path: "." },
      revisionHistoryLimit: null,
      syncPolicy: undefined,
    });

    expect(application.toJson().spec).not.toHaveProperty(
      "revisionHistoryLimit",
    );
  });

  test("merges the spec escape hatch over the derived fields", () => {
    const application = argoApplication(chart(), {
      name: "tracker",
      namespace: "tracker",
      source: { repoUrl: "https://example.invalid", path: "." },
      syncPolicy: AUTOMATED,
      spec: {
        project: "default",
        info: [{ name: "owner", value: "platform" }],
      },
    });
    const { spec } = application.toJson();

    expect(spec.project).toBe("default");
    expect(spec.info).toEqual([{ name: "owner", value: "platform" }]);
    expect(spec.syncPolicy).toEqual(AUTOMATED);
  });
});
