import { describe, expect, it } from "vitest";
import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { clusterObservabilitySyncPrunes } from "./prune.ts";
import {
  renderedRelease,
  selectionRelease,
  type RetiredRouteRelease,
} from "#lib/delivery/retired-route-prune.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { requireModelRecipe } from "#lib/delivery/model/recipe.ts";
import { artifact, detail } from "#lib/delivery/model/testing.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";
import type { ManagedResource } from "homelab/scripts/argocd/argocd-apply-safety.ts";

const APP_NAMESPACE = "argocd";
const RETIRED_RULES = [
  { name: "prometheus-retired-app-rules", namespace: "retired-app" },
  { name: "prometheus-legacy-rules", namespace: "prometheus" },
] as const;
const ACTIVE_RULE = { name: "prometheus-flags-rules", namespace: "flags" };

const selection = {
  application: "cluster-observability",
  chart: "cluster-observability",
  namespace: APP_NAMESPACE,
  environmentId: "cluster-observability/prod",
  repository: "https://chartmuseum.tailnet-1a49.ts.net",
  revision: "1.0.0-12",
  parameters: {},
};

const clusterObservabilityRecipe = {
  kind: "kubernetes-application",
  application: {
    name: "cluster-observability",
    metadata: {
      labels: { "ci.sjer.red/managed-application": "true" },
      annotations: {
        "argocd.argoproj.io/sync-options": "Prune=false",
        "ci.sjer.red/application-lifecycle": "retain",
      },
      finalizers: [],
    },
    project: "cluster",
    destination: {
      server: "https://kubernetes.default.svc",
      namespace: APP_NAMESPACE,
    },
    source: {
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "cluster-observability",
    },
    syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
    ignoreDifferences: [],
    revisionHistoryLimit: 5,
    lifecycle: "retain",
  },
  chartComponent: "chart:cluster-observability",
  artifactParameters: {},
  runner: { service: "ci", component: "image:ci-base" },
  steps: [
    { kind: "apply-safety", instance: "application:cluster-observability" },
    { kind: "sync", instance: "application:cluster-observability" },
  ],
  sharedLock: "platform",
  oracle: { probes: [], tests: [] },
};

function clusterObservabilityRendered() {
  const chart = artifact({
    id: "chart/cluster-observability",
    component: "chart:cluster-observability",
    kind: "chart",
    uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/cluster-observability-1.0.0-12.tgz",
    version: "1.0.0-12",
    character: "b",
  });
  const base = detail(clusterObservabilityRecipe, chart);
  const current = DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      serviceId: "cluster-observability",
      environmentId: "cluster-observability/prod",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "cluster-observability",
    },
    configuration: { id: "config/1", content: {} },
  });
  const recipe = requireModelRecipe(current);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("cluster-observability recipe is a Kubernetes application");
  return renderApplication(current, recipe);
}

type Mode = "direct" | "rendered";

function frozenApplication(mode: Mode) {
  const succeededStatus = {
    operationState: { phase: "Succeeded", operation: { info: [] } },
  };
  if (mode === "rendered") {
    const rendered = clusterObservabilityRendered();
    return {
      release: renderedRelease(rendered),
      app: {
        metadata: {
          ...rendered.body.metadata,
          uid: "cluster-obs-uid",
          resourceVersion: "42",
        },
        spec: structuredClone(rendered.body.spec),
        status: succeededStatus,
      },
    };
  }
  const sourceSpec = () => ({
    chart: selection.chart,
    repoURL: selection.repository,
    targetRevision: selection.revision,
    helm: { parameters: deliveryArgoParameters(selection.parameters) },
  });
  return {
    release: {
      ...selection,
      source: sourceSpec,
    } satisfies RetiredRouteRelease,
    app: {
      metadata: {
        name: selection.application,
        uid: "cluster-obs-uid",
        resourceVersion: "42",
        annotations: {
          [DELIVERY_ENVIRONMENT_ANNOTATION]: selection.environmentId,
        },
      },
      spec: {
        source: sourceSpec(),
        destination: { namespace: APP_NAMESPACE },
        syncPolicy: { automated: { enabled: false } },
      },
      status: succeededStatus,
    },
  };
}

function prometheusRuleResource(name: string, namespace: string) {
  return {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "PrometheusRule",
    metadata: {
      name,
      namespace,
      uid: `${namespace}-${name}-uid`,
      annotations: {
        "argocd.argoproj.io/tracking-id": `cluster-observability:monitoring.coreos.com/PrometheusRule:${namespace}/${name}`,
      },
    },
  };
}

function fixture(mode: Mode) {
  const { release, app } = frozenApplication(mode);
  const native = RETIRED_RULES.map((item) =>
    prometheusRuleResource(item.name, item.namespace),
  );
  const active = prometheusRuleResource(
    ACTIVE_RULE.name,
    ACTIVE_RULE.namespace,
  );
  const byNamespaceAndName = new Map<
    string,
    ReturnType<typeof prometheusRuleResource>
  >([
    ...RETIRED_RULES.map(
      (item, index) =>
        [
          `${item.namespace}/${item.name}`,
          native[index] ?? prometheusRuleResource(item.name, item.namespace),
        ] as const,
    ),
    [`${ACTIVE_RULE.namespace}/${ACTIVE_RULE.name}`, active],
  ]);
  const manifests: unknown[] = [active];
  const managed: ManagedResource[] = native.map((resource) => ({
    group: "monitoring.coreos.com",
    kind: "PrometheusRule",
    name: resource.metadata.name,
    namespace: resource.metadata.namespace,
    liveState: JSON.stringify(resource),
  }));
  managed.push({
    group: "monitoring.coreos.com",
    kind: "PrometheusRule",
    name: ACTIVE_RULE.name,
    namespace: ACTIVE_RULE.namespace,
    liveState: JSON.stringify(active),
    targetState: JSON.stringify(active),
  });
  const after = structuredClone(app);
  const nativeReads: string[] = [];
  let servedInitialApp = false;
  const read = async (path: string): Promise<unknown> => {
    const [route = "", rawQuery = ""] = path.split("?");
    if (rawQuery === "revision=1.0.0-12" && route.endsWith("/manifests")) {
      return { manifests: manifests.map((entry) => JSON.stringify(entry)) };
    }
    if (route.endsWith("/managed-resources")) return { items: managed };
    if (route.endsWith("/resource")) {
      const params = new URLSearchParams(rawQuery);
      const lookupKey = `${params.get("namespace") ?? ""}/${params.get("resourceName") ?? ""}`;
      nativeReads.push(lookupKey);
      const found = byNamespaceAndName.get(lookupKey);
      if (found === undefined)
        throw new Error(`Missing native fixture ${lookupKey}`);
      return { manifest: JSON.stringify(found) };
    }
    const snapshot = servedInitialApp ? after : app;
    servedInitialApp = true;
    return structuredClone(snapshot);
  };
  return {
    release,
    app,
    after,
    native,
    active,
    manifests,
    managed,
    nativeReads,
    read,
  };
}

describe("cluster-observability release keys", () => {
  it("derives the exact scope from cluster-observability registered model render", () => {
    const release = renderedRelease(clusterObservabilityRendered());
    expect(release).toMatchObject({
      application: "cluster-observability",
      chart: "cluster-observability",
      namespace: APP_NAMESPACE,
      environmentId: "cluster-observability/prod",
      revision: "1.0.0-12",
    });
  });

  it("refuses legacy v1 selectionRelease because cluster-observability is registered only in v2", async () => {
    const f = fixture("direct");
    await expect(
      clusterObservabilitySyncPrunes(selectionRelease(selection), f.read),
    ).rejects.toThrow(
      "Application has not been delegated to this Delivery environment",
    );
  });
});

describe.each(["direct", "rendered"] as const)(
  "cluster-observability retired PrometheusRule pruning (%s release)",
  (mode) => {
    it("permits pruning retired owned PrometheusRule CRs across workload namespaces while retaining active rules", async () => {
      const f = fixture(mode);
      await expect(
        clusterObservabilitySyncPrunes(f.release, f.read),
      ).resolves.toBe(true);
      expect(f.nativeReads).toEqual([
        "retired-app/prometheus-retired-app-rules",
        "prometheus/prometheus-legacy-rules",
      ]);
      expect(f.app).toEqual(f.after);
    });

    it("does not prune other applications or a release with nothing obsolete", async () => {
      const other: RetiredRouteRelease = {
        ...fixture(mode).release,
        application: "arcade",
      };
      await expect(
        clusterObservabilitySyncPrunes(other, () =>
          Promise.reject(new Error("Must not read another application")),
        ),
      ).resolves.toBe(false);
      const f = fixture(mode);
      f.managed.splice(0, RETIRED_RULES.length);
      await expect(
        clusterObservabilitySyncPrunes(f.release, f.read),
      ).resolves.toBe(false);
    });

    it.each(["chart", "namespace", "environmentId"] as const)(
      "rejects a different %s on the release",
      async (field) => {
        const f = fixture(mode);
        await expect(
          clusterObservabilitySyncPrunes(
            { ...f.release, [field]: "foreign" },
            f.read,
          ),
        ).rejects.toThrow(
          "Cluster observability pruning requires its exact registered scope",
        );
      },
    );

    it.each([
      {
        label: "non-PrometheusRule kind",
        mutate: (item: ManagedResource) => {
          item.kind = "ServiceMonitor";
        },
      },
      {
        label: "storage resource",
        mutate: (item: ManagedResource) => {
          item.group = "";
          item.kind = "PersistentVolumeClaim";
          item.name = "prometheus-data";
        },
      },
      {
        label: "foreign API group",
        mutate: (item: ManagedResource) => {
          item.group = "networking.k8s.io";
        },
      },
      {
        label: "unprefixed PrometheusRule name",
        mutate: (item: ManagedResource) => {
          item.name = "retired-app-rules";
        },
      },
      {
        label: "cluster-scoped resource without namespace",
        mutate: (item: ManagedResource) => {
          item.namespace = "";
        },
      },
    ])("refuses an obsolete $label", async ({ mutate }) => {
      const f = fixture(mode);
      const first = f.managed[0];
      if (first === undefined) throw new Error("Missing managed fixture");
      mutate(first);
      await expect(
        clusterObservabilitySyncPrunes(f.release, f.read),
      ).rejects.toThrow(
        "Cluster observability sync refuses unrelated or storage pruning",
      );
    });

    it("refuses a PrometheusRule candidate still declared in the selected render for that namespace", async () => {
      const f = fixture(mode);
      f.manifests.push(f.native[0]);
      await expect(
        clusterObservabilitySyncPrunes(f.release, f.read),
      ).rejects.toThrow(
        "Cluster observability prune candidate remains in the selected render",
      );
    });

    it.each([
      "uid",
      "duplicate-uid",
      "apiVersion",
      "kind",
      "name",
      "tracking",
      "foreign-app",
      "hook",
      "deleting",
      "namespace",
    ] as const)(
      "refuses a live PrometheusRule that is not the exact owned resource (%s)",
      async (field) => {
        const f = fixture(mode);
        const resource = f.native[0];
        const second = f.native[1];
        const secondManaged = f.managed[1];
        if (
          resource === undefined ||
          second === undefined ||
          secondManaged === undefined
        )
          throw new Error("Missing PrometheusRule fixture");
        const annotations: Record<string, string> =
          resource.metadata.annotations;
        const mutators: Record<typeof field, () => void> = {
          uid: () => {
            resource.metadata.uid = "replacement";
          },
          "duplicate-uid": () => {
            second.metadata.uid = resource.metadata.uid;
            secondManaged.liveState = JSON.stringify(second);
          },
          apiVersion: () => {
            resource.apiVersion = "v1";
          },
          kind: () => {
            resource.kind = "ServiceMonitor";
          },
          name: () => {
            resource.metadata.name = "prometheus-other";
          },
          tracking: () => {
            annotations["argocd.argoproj.io/tracking-id"] = "foreign";
          },
          "foreign-app": () => {
            annotations["argocd.argoproj.io/tracking-id"] =
              `prometheus:monitoring.coreos.com/PrometheusRule:${resource.metadata.namespace}/${resource.metadata.name}`;
          },
          hook: () => {
            annotations["argocd.argoproj.io/hook"] = "Sync";
          },
          deleting: () => {
            Object.assign(resource.metadata, {
              deletionTimestamp: "2026-11-24T00:00:00Z",
            });
          },
          namespace: () => {
            resource.metadata.namespace = "other";
          },
        };
        mutators[field]();
        await expect(
          clusterObservabilitySyncPrunes(f.release, f.read),
        ).rejects.toThrow(
          "Retired Cluster observability PrometheusRule is not the exact owned resource",
        );
      },
    );
  },
);
