import { describe, expect, it } from "vitest";
import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { alertDashboardSyncPrunes } from "./prune.ts";
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

const NAMESPACE = "alert-dashboard";
const RETIRED = [
  "alert-dashboard-alert-dashboard-ingress-ingress",
  "alert-dashboard-alert-dashboard-ops-ingress-ingress",
] as const;
const HUB_INGRESS = "alert-dashboard-alert-dashboard-hub-ingress-ingress";
const LEDGER = "alert-dashboard-data";

/** The v1 selection Hub's environment releases. */
const selection = {
  application: "alert-dashboard",
  chart: "alert-dashboard",
  namespace: NAMESPACE,
  environmentId: "ops-dashboard/prod",
  repository: "https://chartmuseum.tailnet-1a49.ts.net",
  revision: "1.0.0-7",
  parameters: {
    "delivery.images.alert-dashboard": `image@sha256:${"a".repeat(64)}`,
  },
};

/** The registered model recipe (registrations/v2/ops-dashboard/prod). */
const hubRecipe = {
  kind: "kubernetes-application",
  application: {
    name: "alert-dashboard",
    metadata: {
      labels: { "ci.sjer.red/managed-application": "true" },
      annotations: {
        "argocd.argoproj.io/sync-options": "Prune=false",
        "ci.sjer.red/application-lifecycle": "retain",
      },
      finalizers: [],
    },
    project: "workloads",
    destination: {
      server: "https://kubernetes.default.svc",
      namespace: NAMESPACE,
    },
    source: {
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "alert-dashboard",
    },
    syncOptions: ["CreateNamespace=true"],
    ignoreDifferences: [],
    revisionHistoryLimit: 5,
    lifecycle: "retain",
  },
  chartComponent: "chart:alert-dashboard",
  artifactParameters: {
    "delivery.images.alert-dashboard": {
      component: "image:alert-dashboard",
      format: "reference",
    },
  },
  runner: { service: "ci", component: "image:ci-base" },
  steps: [
    { kind: "apply-safety", instance: "application:alert-dashboard" },
    { kind: "sync", instance: "application:alert-dashboard" },
  ],
  oracle: { probes: [], tests: [] },
};

/** Hub's model deployment, rendered as the sync step renders it. */
function hubRendered() {
  const chart = artifact({
    id: "chart/alert-dashboard",
    component: "chart:alert-dashboard",
    kind: "chart",
    uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/alert-dashboard-1.0.0-7.tgz",
    version: "1.0.0-7",
    character: "b",
  });
  const base = detail(hubRecipe, chart);
  const current = DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      serviceId: "ops-dashboard",
      environmentId: "ops-dashboard/prod",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "ops-dashboard",
      components: {
        ...base.versionSet.components,
        "image:alert-dashboard": artifact({
          id: "image/alert-dashboard",
          component: "image:alert-dashboard",
          kind: "image",
          uri: "docker.io/shepherdjerred/alert-dashboard",
          version: "1.0.0-7",
          character: "a",
        }),
      },
    },
    configuration: { id: "config/1", content: {} },
  });
  const recipe = requireModelRecipe(current);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("Hub's recipe is a Kubernetes application");
  return renderApplication(current, recipe);
}

type Mode = "selection" | "rendered";

function frozenApplication(mode: Mode) {
  if (mode === "rendered") {
    const rendered = hubRendered();
    return {
      release: renderedRelease(rendered),
      app: {
        metadata: {
          ...rendered.body.metadata,
          uid: "app-uid",
          resourceVersion: "123",
        },
        spec: structuredClone(rendered.body.spec),
        status: {
          operationState: { phase: "Succeeded", operation: { info: [] } },
        },
      },
    };
  }
  return {
    release: selectionRelease(selection),
    app: {
      metadata: {
        name: "alert-dashboard",
        uid: "app-uid",
        resourceVersion: "123",
        annotations: {
          [DELIVERY_ENVIRONMENT_ANNOTATION]: "ops-dashboard/prod",
        },
      },
      spec: {
        source: {
          chart: selection.chart,
          repoURL: selection.repository,
          targetRevision: selection.revision,
          helm: { parameters: deliveryArgoParameters(selection.parameters) },
        },
        destination: { namespace: NAMESPACE },
        syncPolicy: { automated: { enabled: false } },
      },
      status: {
        operationState: { phase: "Succeeded", operation: { info: [] } },
      },
    },
  };
}

function ingress(name: string) {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name,
      namespace: NAMESPACE,
      uid: `${name}-uid`,
      annotations: {
        "argocd.argoproj.io/tracking-id": `alert-dashboard:networking.k8s.io/Ingress:${NAMESPACE}/${name}`,
      },
    },
  };
}

function fixture(mode: Mode) {
  const { release, app } = frozenApplication(mode);
  const native = RETIRED.map((name) => ingress(name));
  const hub = ingress(HUB_INGRESS);
  const ledger = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: LEDGER, namespace: NAMESPACE, uid: "ledger-uid" },
  };
  const manifests: unknown[] = [hub, ledger];
  const managed: ManagedResource[] = native.map((resource) => ({
    group: "networking.k8s.io",
    kind: "Ingress",
    name: resource.metadata.name,
    namespace: NAMESPACE,
    liveState: JSON.stringify(resource),
  }));
  managed.push(
    {
      group: "networking.k8s.io",
      kind: "Ingress",
      name: HUB_INGRESS,
      namespace: NAMESPACE,
      liveState: JSON.stringify(hub),
      targetState: JSON.stringify(hub),
    },
    {
      group: "",
      kind: "PersistentVolumeClaim",
      name: LEDGER,
      namespace: NAMESPACE,
      liveState: JSON.stringify(ledger),
      targetState: JSON.stringify(ledger),
    },
  );
  const after = structuredClone(app);
  const nativeReads: string[] = [];
  let appReads = 0;
  const read = async (path: string): Promise<unknown> => {
    if (path.endsWith("/manifests?revision=1.0.0-7"))
      return {
        manifests: manifests.map((resource) => JSON.stringify(resource)),
      };
    if (path.endsWith("/managed-resources")) return { items: managed };
    if (path.includes("/resource?")) {
      const query = new URLSearchParams(path.split("?")[1]);
      const name = query.get("resourceName") ?? "";
      nativeReads.push(name);
      const resource = [...native, hub, ledger].find(
        (item) => item.metadata.name === name,
      );
      if (resource === undefined) throw new Error("Missing native fixture");
      return { manifest: JSON.stringify(resource) };
    }
    return structuredClone(appReads++ === 0 ? app : after);
  };
  return {
    release,
    app,
    after,
    native,
    hub,
    ledger,
    manifests,
    managed,
    nativeReads,
    read,
  };
}

/** Makes a retained resource obsolete: live, but gone from the render. */
function retire(f: ReturnType<typeof fixture>, name: string) {
  const resource = f.managed.find((item) => item.name === name);
  if (resource === undefined) throw new Error(`Missing managed ${name}`);
  delete resource.targetState;
  f.manifests.splice(
    f.manifests.indexOf(name === LEDGER ? f.ledger : f.hub),
    1,
  );
}

describe("Hub release keys", () => {
  it("derives the rule's exact scope from Hub's registered model render", () => {
    const release = renderedRelease(hubRendered());
    expect(release).toMatchObject({
      application: "alert-dashboard",
      chart: "alert-dashboard",
      namespace: NAMESPACE,
      environmentId: "ops-dashboard/prod",
      revision: "1.0.0-7",
    });
  });
});

describe.each(["selection", "rendered"] as const)(
  "Hub retired ingress pruning (%s release)",
  (mode) => {
    it("permits exactly the two retired owned ingresses while retaining hub and the ledger", async () => {
      const f = fixture(mode);
      await expect(alertDashboardSyncPrunes(f.release, f.read)).resolves.toBe(
        true,
      );
      expect(f.nativeReads).toEqual([...RETIRED]);
      expect(f.app).toEqual(f.after);
    });

    it("does not prune other applications or a release with nothing obsolete", async () => {
      const other: RetiredRouteRelease = {
        ...fixture(mode).release,
        application: "arcade",
      };
      await expect(
        alertDashboardSyncPrunes(other, async () => {
          throw new Error("Must not read another application");
        }),
      ).resolves.toBe(false);
      const f = fixture(mode);
      f.managed.splice(0, RETIRED.length);
      await expect(alertDashboardSyncPrunes(f.release, f.read)).resolves.toBe(
        false,
      );
    });

    it.each(["chart", "namespace", "environmentId"] as const)(
      "rejects a different %s",
      async (field) => {
        const f = fixture(mode);
        await expect(
          alertDashboardSyncPrunes(
            { ...f.release, [field]: "foreign" },
            f.read,
          ),
        ).rejects.toThrow("Hub pruning requires its exact registered scope");
      },
    );

    it.each([LEDGER, HUB_INGRESS])(
      "refuses to prune the retained %s",
      async (name) => {
        const f = fixture(mode);
        retire(f, name);
        await expect(
          alertDashboardSyncPrunes(f.release, f.read),
        ).rejects.toThrow("Hub sync refuses unrelated or storage pruning");
      },
    );

    it("refuses a retired ingress in a foreign namespace", async () => {
      const f = fixture(mode);
      f.managed[0]!.namespace = "arcade";
      await expect(alertDashboardSyncPrunes(f.release, f.read)).rejects.toThrow(
        "unrelated or storage",
      );
    });

    it("refuses a retired ingress still declared in the selected render", async () => {
      const f = fixture(mode);
      f.manifests.push(f.native[1]);
      await expect(alertDashboardSyncPrunes(f.release, f.read)).rejects.toThrow(
        "Hub prune candidate remains in the selected render",
      );
    });

    it.each([
      "uid",
      "tracking",
      "foreign-app",
      "hook",
      "deleting",
      "namespace",
    ])(
      "refuses a live ingress that is not the exact owned resource (%s)",
      async (field) => {
        const f = fixture(mode);
        const resource = f.native[0]!;
        const annotations: Record<string, string> =
          resource.metadata.annotations;
        if (field === "uid") resource.metadata.uid = "replacement";
        if (field === "tracking")
          annotations["argocd.argoproj.io/tracking-id"] = "foreign";
        if (field === "foreign-app")
          annotations["argocd.argoproj.io/tracking-id"] =
            `arcade:networking.k8s.io/Ingress:${NAMESPACE}/${resource.metadata.name}`;
        if (field === "hook") annotations["argocd.argoproj.io/hook"] = "Sync";
        if (field === "deleting")
          Object.assign(resource.metadata, {
            deletionTimestamp: "2026-11-21T00:00:00Z",
          });
        if (field === "namespace") resource.metadata.namespace = "arcade";
        await expect(
          alertDashboardSyncPrunes(f.release, f.read),
        ).rejects.toThrow("Retired Hub route is not the exact owned resource");
      },
    );

    it("refuses a replaced Application before sync", async () => {
      const f = fixture(mode);
      f.after.metadata.uid = "replacement";
      await expect(alertDashboardSyncPrunes(f.release, f.read)).rejects.toThrow(
        "Hub source or Application changed before sync",
      );
    });

    it("refuses an Application whose source is not the frozen release", async () => {
      const f = fixture(mode);
      f.app.spec.source.targetRevision = "1.0.0-6";
      await expect(alertDashboardSyncPrunes(f.release, f.read)).rejects.toThrow(
        mode === "selection"
          ? "Hub source must already match its frozen selection"
          : "source differs from the rendered exact source",
      );
    });

    it("refuses while an Application operation is still running", async () => {
      const f = fixture(mode);
      f.app.status.operationState.phase = "Running";
      await expect(alertDashboardSyncPrunes(f.release, f.read)).rejects.toThrow(
        "Application operation is not settled",
      );
    });
  },
);
