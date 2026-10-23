import { describe, expect, it } from "vitest";
import { arcadeSyncPrunes } from "./prune.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";
import type { ManagedResource } from "homelab/scripts/argocd/argocd-apply-safety.ts";

const selection = {
  application: "arcade",
  chart: "arcade",
  namespace: "arcade",
  environmentId: "arcade/prod",
  repository: "https://chartmuseum.sjer.red",
  revision: "2.0.0-42",
  parameters: { "delivery.image": `image@sha256:${"a".repeat(64)}` },
};
const routes = [
  ["", "v1", "Service", "arcade-legacy-redirects"],
  ["networking.k8s.io", "v1", "Ingress", "arcade-mariokart-tailscale-ingress"],
  ["networking.k8s.io", "v1", "Ingress", "arcade-pokebot-tailscale-ingress"],
  [
    "networking.cfargotunnel.com",
    "v1alpha1",
    "TunnelBinding",
    "arcade-mariokart-cf-tunnel",
  ],
  [
    "networking.cfargotunnel.com",
    "v1alpha1",
    "TunnelBinding",
    "arcade-pokebot-cf-tunnel",
  ],
] as const;

function fixture() {
  const app = {
    metadata: {
      name: "arcade",
      uid: "app-uid",
      resourceVersion: "123",
      annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: "arcade/prod" },
    },
    spec: {
      source: {
        chart: selection.chart,
        repoURL: selection.repository,
        targetRevision: selection.revision,
        helm: { parameters: deliveryArgoParameters(selection.parameters) },
      },
      destination: { namespace: "arcade" },
      syncPolicy: { automated: { enabled: false } },
    },
    status: { operationState: { phase: "Succeeded" } },
  };
  const native = routes.map(([group, version, kind, name]) => ({
    apiVersion: group === "" ? version : `${group}/${version}`,
    kind,
    metadata: {
      name,
      namespace: "arcade",
      uid: `${name}-uid`,
      annotations: {
        "argocd.argoproj.io/tracking-id": `arcade:${group}/${kind}:arcade/${name}`,
      },
    },
  }));
  const storage = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: "arcade-edge-data", namespace: "arcade" },
  };
  const manifests: unknown[] = [storage];
  const managed: ManagedResource[] = routes.map(
    ([group, _version, kind, name], offset) => ({
      group,
      kind,
      name,
      namespace: "arcade",
      liveState: JSON.stringify(native[offset]),
    }),
  );
  managed.push({
    group: "",
    kind: storage.kind,
    name: storage.metadata.name,
    namespace: "arcade",
    liveState: JSON.stringify(storage),
    targetState: JSON.stringify(storage),
  });
  const after = structuredClone(app);
  let appReads = 0;
  const read = async (path: string): Promise<unknown> => {
    if (path.endsWith("/manifests?revision=2.0.0-42"))
      return {
        manifests: manifests.map((resource) => JSON.stringify(resource)),
      };
    if (path.endsWith("/managed-resources")) return { items: managed };
    if (path.includes("/resource?")) {
      const query = new URLSearchParams(path.split("?")[1]);
      const resource = native.find(
        (item) => item.metadata.name === query.get("resourceName"),
      );
      if (resource === undefined) throw new Error("Missing native fixture");
      return { manifest: JSON.stringify(resource) };
    }
    return structuredClone(appReads++ === 0 ? app : after);
  };
  return { app, after, native, manifests, managed, read };
}

describe("Arcade legacy route retirement", () => {
  it("permits exactly the five obsolete owned routes while retaining storage", async () => {
    const f = fixture();
    await expect(arcadeSyncPrunes(selection, f.read)).resolves.toBe(true);
    expect(f.app).toEqual(f.after);
    expect(f.managed.at(-1)?.kind).toBe("PersistentVolumeClaim");
  });
  it("does not prune other applications or an Arcade release with no obsolete routes", async () => {
    await expect(
      arcadeSyncPrunes({ ...selection, application: "pokemon" }, async () => {
        throw new Error("Must not read another application");
      }),
    ).resolves.toBe(false);
    const f = fixture();
    f.managed.splice(0, routes.length);
    await expect(arcadeSyncPrunes(selection, f.read)).resolves.toBe(false);
  });
  it.each(["chart", "namespace", "environmentId"] as const)(
    "rejects a different %s",
    async (field) => {
      await expect(
        arcadeSyncPrunes({ ...selection, [field]: "foreign" }, fixture().read),
      ).rejects.toThrow("registered scope");
    },
  );
  it.each([
    "PersistentVolumeClaim",
    "Namespace",
    "Deployment",
    "OnePasswordItem",
    "Service",
  ])("rejects an unrelated obsolete %s", async (kind) => {
    const f = fixture();
    f.managed.push({
      group: "",
      kind,
      name: "retained-resource",
      namespace: "arcade",
      liveState: JSON.stringify({ kind }),
    });
    await expect(arcadeSyncPrunes(selection, f.read)).rejects.toThrow(
      "unrelated or storage",
    );
  });
  it("refuses a foreign namespace and a route still declared in the frozen chart", async () => {
    const foreign = fixture();
    foreign.managed[0]!.namespace = "pokemon";
    await expect(arcadeSyncPrunes(selection, foreign.read)).rejects.toThrow(
      "unrelated or storage",
    );
    const declared = fixture();
    declared.manifests.push(declared.native[0]);
    await expect(arcadeSyncPrunes(selection, declared.read)).rejects.toThrow(
      "selected render",
    );
  });
  it.each(["uid", "tracking", "hook", "deleting", "kind", "namespace"])(
    "refuses changed native %s",
    async (field) => {
      const f = fixture();
      const resource = f.native[0]!;
      if (field === "uid") resource.metadata.uid = "replacement";
      if (field === "tracking")
        resource.metadata.annotations["argocd.argoproj.io/tracking-id"] =
          "foreign";
      if (field === "hook")
        Object.assign(resource.metadata.annotations, {
          "argocd.argoproj.io/hook": "Sync",
        });
      if (field === "deleting")
        Object.assign(resource.metadata, {
          deletionTimestamp: "2026-10-22T00:00:00Z",
        });
      if (field === "kind")
        Object.assign(resource, { kind: "PersistentVolumeClaim" });
      if (field === "namespace") resource.metadata.namespace = "pokemon";
      await expect(arcadeSyncPrunes(selection, f.read)).rejects.toThrow(
        "exact owned",
      );
    },
  );
  it("refuses a mismatched initial selection, changed source or replacement Application", async () => {
    const initial = fixture();
    initial.app.spec.source.targetRevision = "2.0.0-41";
    await expect(arcadeSyncPrunes(selection, initial.read)).rejects.toThrow(
      "frozen selection",
    );
    const changed = fixture();
    changed.after.spec.source.targetRevision = "2.0.0-43";
    await expect(arcadeSyncPrunes(selection, changed.read)).rejects.toThrow(
      "changed before sync",
    );
    const replaced = fixture();
    replaced.after.metadata.uid = "replacement";
    await expect(arcadeSyncPrunes(selection, replaced.read)).rejects.toThrow(
      "changed before sync",
    );
  });
  it("fails on unreadable managed state", async () => {
    const f = fixture();
    f.managed[0]!.liveState = "not-json";
    await expect(arcadeSyncPrunes(selection, f.read)).rejects.toThrow(
      "Could not read liveState",
    );
  });
});
