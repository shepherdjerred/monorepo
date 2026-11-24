import { describe, expect, it } from "vitest";
import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { serviceProbesSyncPrunes } from "./prune.ts";
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

const NAMESPACE = "prometheus";
const RETIRED_PROBES = ["probe-relay-http", "probe-relay-tailnet"] as const;
const ACTIVE_PROBE = "probe-flags-http";

const selection = {
  application: "service-probes",
  chart: "service-probes",
  namespace: NAMESPACE,
  environmentId: "service-probes/prod",
  repository: "https://chartmuseum.tailnet-1a49.ts.net",
  revision: "1.0.0-12",
  parameters: {},
};

const serviceProbesRecipe = {
  kind: "kubernetes-application",
  application: {
    name: "service-probes",
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
      chart: "service-probes",
    },
    syncOptions: [],
    ignoreDifferences: [],
    revisionHistoryLimit: 5,
    lifecycle: "retain",
  },
  chartComponent: "chart:service-probes",
  artifactParameters: {},
  runner: { service: "ci", component: "image:ci-base" },
  steps: [
    { kind: "apply-safety", instance: "application:service-probes" },
    { kind: "sync", instance: "application:service-probes" },
  ],
  oracle: { probes: [], tests: [] },
};

function serviceProbesRendered() {
  const chart = artifact({
    id: "chart/service-probes",
    component: "chart:service-probes",
    kind: "chart",
    uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/service-probes-1.0.0-12.tgz",
    version: "1.0.0-12",
    character: "b",
  });
  const base = detail(serviceProbesRecipe, chart);
  const current = DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      serviceId: "service-probes",
      environmentId: "service-probes/prod",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "service-probes",
    },
    configuration: { id: "config/1", content: {} },
  });
  const recipe = requireModelRecipe(current);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("service-probes recipe is a Kubernetes application");
  return renderApplication(current, recipe);
}

type Mode = "direct" | "rendered";

function frozenApplication(mode: Mode) {
  if (mode === "rendered") {
    const rendered = serviceProbesRendered();
    return {
      release: renderedRelease(rendered),
      app: {
        metadata: {
          ...rendered.body.metadata,
          uid: "service-probes-uid",
          resourceVersion: "123",
        },
        spec: structuredClone(rendered.body.spec),
        status: {
          operationState: { phase: "Succeeded", operation: { info: [] } },
        },
      },
    };
  }
  const expectedSource = {
    chart: selection.chart,
    repoURL: selection.repository,
    targetRevision: selection.revision,
    helm: { parameters: deliveryArgoParameters(selection.parameters) },
  };
  return {
    release: {
      application: selection.application,
      chart: selection.chart,
      namespace: selection.namespace,
      environmentId: selection.environmentId,
      revision: selection.revision,
      source: () => structuredClone(expectedSource),
    } satisfies RetiredRouteRelease,
    app: {
      metadata: {
        name: "service-probes",
        uid: "service-probes-uid",
        resourceVersion: "123",
        annotations: {
          [DELIVERY_ENVIRONMENT_ANNOTATION]: "service-probes/prod",
        },
      },
      spec: {
        source: structuredClone(expectedSource),
        destination: { namespace: NAMESPACE },
        syncPolicy: { automated: { enabled: false } },
      },
      status: {
        operationState: { phase: "Succeeded", operation: { info: [] } },
      },
    },
  };
}

function probeResource(name: string) {
  return {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "Probe",
    metadata: {
      name,
      namespace: NAMESPACE,
      uid: `${name}-uid`,
      annotations: {
        "argocd.argoproj.io/tracking-id": `service-probes:monitoring.coreos.com/Probe:${NAMESPACE}/${name}`,
      },
    },
  };
}

function fixture(mode: Mode) {
  const { release, app } = frozenApplication(mode);
  const native = RETIRED_PROBES.map((name) => probeResource(name));
  const active = probeResource(ACTIVE_PROBE);
  const byOriginalName = new Map<string, ReturnType<typeof probeResource>>([
    ...RETIRED_PROBES.map(
      (name, index) => [name, native[index] ?? probeResource(name)] as const,
    ),
    [ACTIVE_PROBE, active],
  ]);
  const manifests: unknown[] = [active];
  const managed: ManagedResource[] = native.map((resource) => ({
    group: "monitoring.coreos.com",
    kind: "Probe",
    name: resource.metadata.name,
    namespace: NAMESPACE,
    liveState: JSON.stringify(resource),
  }));
  managed.push({
    group: "monitoring.coreos.com",
    kind: "Probe",
    name: ACTIVE_PROBE,
    namespace: NAMESPACE,
    liveState: JSON.stringify(active),
    targetState: JSON.stringify(active),
  });
  const after = structuredClone(app);
  const nativeReads: string[] = [];
  let appReads = 0;
  const read = (path: string): Promise<unknown> => {
    if (path.endsWith("/manifests?revision=1.0.0-12")) {
      return Promise.resolve({
        manifests: manifests.map((resource) => JSON.stringify(resource)),
      });
    }
    if (path.endsWith("/managed-resources"))
      return Promise.resolve({ items: managed });
    if (path.includes("/resource?")) {
      const query = new URLSearchParams(path.split("?")[1]);
      const name = query.get("resourceName") ?? "";
      nativeReads.push(name);
      const resource = byOriginalName.get(name);
      return resource === undefined
        ? Promise.reject(new Error("Missing native fixture"))
        : Promise.resolve({ manifest: JSON.stringify(resource) });
    }
    return Promise.resolve(structuredClone(appReads++ === 0 ? app : after));
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

describe("service-probes release keys", () => {
  it("derives the exact scope from service-probes registered model render", () => {
    const release = renderedRelease(serviceProbesRendered());
    expect(release).toMatchObject({
      application: "service-probes",
      chart: "service-probes",
      namespace: NAMESPACE,
      environmentId: "service-probes/prod",
      revision: "1.0.0-12",
    });
  });

  it("refuses legacy v1 selectionRelease because service-probes is registered only in v2", async () => {
    const f = fixture("direct");
    await expect(
      serviceProbesSyncPrunes(selectionRelease(selection), f.read),
    ).rejects.toThrow(
      "Application has not been delegated to this Delivery environment",
    );
  });
});

describe.each(["direct", "rendered"] as const)(
  "service-probes retired Probe pruning (%s release)",
  (mode) => {
    it("permits pruning retired owned Probe CRs while retaining active probes", async () => {
      const f = fixture(mode);
      await expect(serviceProbesSyncPrunes(f.release, f.read)).resolves.toBe(
        true,
      );
      expect(f.nativeReads).toEqual([...RETIRED_PROBES]);
      expect(f.app).toEqual(f.after);
    });

    it("does not prune other applications or a release with nothing obsolete", async () => {
      const other: RetiredRouteRelease = {
        ...fixture(mode).release,
        application: "arcade",
      };
      await expect(
        serviceProbesSyncPrunes(other, () =>
          Promise.reject(new Error("Must not read another application")),
        ),
      ).resolves.toBe(false);
      const f = fixture(mode);
      f.managed.splice(0, RETIRED_PROBES.length);
      await expect(serviceProbesSyncPrunes(f.release, f.read)).resolves.toBe(
        false,
      );
    });

    it.each(["chart", "namespace", "environmentId"] as const)(
      "rejects a different %s",
      async (field) => {
        const f = fixture(mode);
        await expect(
          serviceProbesSyncPrunes({ ...f.release, [field]: "foreign" }, f.read),
        ).rejects.toThrow(
          "Service probes pruning requires its exact registered scope",
        );
      },
    );

    it.each([
      {
        label: "non-Probe kind",
        mutate: (item: ManagedResource) => {
          item.kind = "ServiceMonitor";
        },
      },
      {
        label: "storage resource",
        mutate: (item: ManagedResource) => {
          item.group = "";
          item.kind = "PersistentVolumeClaim";
          item.name = "probe-data";
        },
      },
      {
        label: "foreign API group",
        mutate: (item: ManagedResource) => {
          item.group = "networking.k8s.io";
        },
      },
      {
        label: "unprefixed Probe name",
        mutate: (item: ManagedResource) => {
          item.name = "relay-http";
        },
      },
      {
        label: "foreign namespace",
        mutate: (item: ManagedResource) => {
          item.namespace = "relay";
        },
      },
    ])("refuses an obsolete $label", async ({ mutate }) => {
      const f = fixture(mode);
      const first = f.managed[0];
      if (first === undefined) throw new Error("Missing managed fixture");
      mutate(first);
      await expect(serviceProbesSyncPrunes(f.release, f.read)).rejects.toThrow(
        "Service probes sync refuses unrelated or storage pruning",
      );
    });

    it("refuses a Probe candidate still declared in the selected render", async () => {
      const f = fixture(mode);
      f.manifests.push(f.native[1]);
      await expect(serviceProbesSyncPrunes(f.release, f.read)).rejects.toThrow(
        "Service probes prune candidate remains in the selected render",
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
      "refuses a live Probe that is not the exact owned resource (%s)",
      async (field) => {
        const f = fixture(mode);
        const resource = f.native[0];
        const second = f.native[1];
        const secondManaged = f.managed[1];
        if (
          resource === undefined ||
          second === undefined ||
          secondManaged === undefined
        ) {
          throw new Error("Missing probe fixture");
        }
        const annotations: Record<string, string> =
          resource.metadata.annotations;
        if (field === "uid") resource.metadata.uid = "replacement";
        if (field === "duplicate-uid") {
          second.metadata.uid = resource.metadata.uid;
          secondManaged.liveState = JSON.stringify(second);
        }
        if (field === "apiVersion") resource.apiVersion = "v1";
        if (field === "kind") resource.kind = "ServiceMonitor";
        if (field === "name") resource.metadata.name = "probe-other";
        if (field === "tracking")
          annotations["argocd.argoproj.io/tracking-id"] = "foreign";
        if (field === "foreign-app")
          annotations["argocd.argoproj.io/tracking-id"] =
            `prometheus:monitoring.coreos.com/Probe:${NAMESPACE}/${resource.metadata.name}`;
        if (field === "hook") annotations["argocd.argoproj.io/hook"] = "Sync";
        if (field === "deleting")
          Object.assign(resource.metadata, {
            deletionTimestamp: "2026-11-24T00:00:00Z",
          });
        if (field === "namespace") resource.metadata.namespace = "relay";
        await expect(
          serviceProbesSyncPrunes(f.release, f.read),
        ).rejects.toThrow(
          "Retired Service probes probe is not the exact owned resource",
        );
      },
    );

    it("refuses a replaced Application before sync", async () => {
      const f = fixture(mode);
      f.after.metadata.uid = "replacement";
      await expect(serviceProbesSyncPrunes(f.release, f.read)).rejects.toThrow(
        "Service probes source or Application changed before sync",
      );
    });

    it("refuses an Application whose source is not the frozen release", async () => {
      const f = fixture(mode);
      f.app.spec.source.targetRevision = "1.0.0-11";
      await expect(serviceProbesSyncPrunes(f.release, f.read)).rejects.toThrow(
        mode === "direct"
          ? "Service probes source must already match its frozen selection"
          : "source differs from the rendered exact source",
      );
    });

    it("refuses while an Application operation is still running", async () => {
      if (mode === "direct") return;
      const f = fixture(mode);
      f.app.status.operationState.phase = "Running";
      await expect(serviceProbesSyncPrunes(f.release, f.read)).rejects.toThrow(
        "Application operation is not settled",
      );
    });
  },
);
