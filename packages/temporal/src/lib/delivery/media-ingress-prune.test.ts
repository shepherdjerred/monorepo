import { describe, expect, it } from "vitest";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";
import type { ManagedResource } from "homelab/scripts/argocd/argocd-apply-safety.ts";
import { credentialSyncPrunes } from "./credential-prune.ts";
import { mediaIngressSourceHash } from "homelab/scripts/argocd/argocd-media-ingress-prunes.ts";

const legacyApps = [
  "bazarr",
  "maintainerr",
  "prowlarr",
  "radarr",
  "seerr",
  "sonarr",
  "tautulli",
];

function ingress(app: string) {
  const name = `media-${app}-tailscale-ingress-ingress`;
  const annotations: Record<string, string> = {
    "argocd.argoproj.io/tracking-id": `media:networking.k8s.io/Ingress:media/${name}`,
  };
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name,
      namespace: "media",
      uid: `ingress-${app}-uid`,
      finalizers: ["tailscale.com/finalizer"],
      annotations,
    },
    spec: {
      ingressClassName: "tailscale",
      defaultBackend: {
        service: { name: `media-${app}-service`, port: { number: 8080 } },
      },
      tls: [{ hosts: [app] }],
    },
  };
}

function fixture() {
  const selection = {
    name: "media",
    namespace: "media",
    environmentId: "streambot/prod",
    revision: "2.0.0-42",
    source: {
      chart: "media",
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      targetRevision: "2.0.0-42",
      helm: { parameters: deliveryArgoParameters({}) },
    },
  };
  const app = {
    metadata: {
      name: "media",
      uid: "media-app-uid",
      annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: "streambot/prod" },
    },
    spec: {
      source: structuredClone(selection.source),
      destination: { namespace: "media" },
      syncPolicy: { automated: { enabled: false } },
    },
    status: { operationState: { phase: "Succeeded", operation: { info: [] } } },
    operation: null as unknown,
  };
  const writers = [...legacyApps, "recyclarr", "whisperbridge"].map((name) => ({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: `media-${name}`, namespace: "media" },
    spec: { replicas: 0 },
  }));
  const tunnel = {
    apiVersion: "networking.cfargotunnel.com/v1alpha1",
    kind: "TunnelBinding",
    metadata: {
      name: "media-seerr-cf-tunnel",
      namespace: "media",
      finalizers: ["cfargotunnel.com/finalizer"],
    },
    subjects: [
      { kind: "Service", name: "media-api", spec: { fqdn: "seerr.sjer.red" } },
    ],
    tunnelRef: {
      kind: "ClusterTunnel",
      name: "homelab-tunnel",
      disableDNSUpdates: true,
    },
  };
  const pvc = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: "tautulli-pvc", namespace: "media" },
  };
  const extraDesired: unknown[] = [];
  const native = new Map(
    legacyApps.map((name) => {
      const resource = ingress(name);
      return [resource.metadata.name, resource];
    }),
  );
  const managed: ManagedResource[] = [...native.values()].map((resource) => ({
    group: "networking.k8s.io",
    kind: "Ingress",
    name: resource.metadata.name,
    namespace: "media",
    liveState: JSON.stringify(resource),
    targetState: JSON.stringify(resource),
  }));
  managed.push({
    group: "",
    kind: pvc.kind,
    name: pvc.metadata.name,
    namespace: "media",
    liveState: JSON.stringify(pvc),
  });
  const after = structuredClone(app);
  const reads: string[] = [];
  const read = async (path: string): Promise<unknown> => {
    reads.push(path);
    if (path.includes("/manifests?")) {
      return {
        manifests: [...writers, tunnel, pvc, ...extraDesired].map((item) =>
          JSON.stringify(item),
        ),
      };
    }
    if (path.endsWith("/managed-resources")) return { items: managed };
    if (path.includes("/resource?")) {
      const query = new URL(`https://example.com/${path}`).searchParams;
      expect(query.get("group")).toBe("networking.k8s.io");
      expect(query.get("version")).toBe("v1");
      expect(query.get("namespace")).toBe("media");
      expect(query.get("kind")).toBe("Ingress");
      return {
        manifest: JSON.stringify(native.get(query.get("resourceName") ?? "")),
      };
    }
    return path.endsWith("?refresh=hard") ? app : after;
  };
  return {
    selection,
    app,
    after,
    writers,
    tunnel,
    extraDesired,
    native,
    managed,
    read,
    reads,
  };
}

describe("Media ingress retirement through the owned sync", () => {
  it.each([7, 2, 0])(
    "permits exactly the %i remaining reviewed ingresses",
    async (remaining) => {
      const f = fixture();
      f.managed.splice(0, legacyApps.length - remaining);
      const decision = await credentialSyncPrunes(f.selection, f.read);
      if (remaining === 0) {
        expect(decision).toBe(false);
      } else {
        expect(decision).toEqual({
          applicationUid: f.app.metadata.uid,
          sourceHash: mediaIngressSourceHash(f.selection.source),
          resources: legacyApps.slice(-remaining).map((app) => ({
            group: "networking.k8s.io",
            kind: "Ingress",
            namespace: "media",
            name: `media-${app}-tailscale-ingress-ingress`,
            uid: `ingress-${app}-uid`,
          })),
        });
      }
      expect(f.reads[1]).toBe(
        `media/manifests?revision=${f.selection.revision}`,
      );
      const resourceReads = f.reads.filter((path) =>
        path.includes("/resource?"),
      );
      expect(resourceReads).toHaveLength(remaining);
      if (remaining > 0) expect(f.reads.at(-1)).toBe("media");
    },
  );

  it.each([
    "NetworkPolicy",
    "PersistentVolumeClaim",
    "OnePasswordItem",
    "Ingress",
  ])(
    "refuses a mixed proposed prune containing an unrelated %s",
    async (kind) => {
      const f = fixture();
      f.managed.push({
        group: "networking.k8s.io",
        kind,
        name: "foreign",
        namespace: "media",
        liveState: JSON.stringify({ kind }),
      });
      await expect(credentialSyncPrunes(f.selection, f.read)).rejects.toThrow(
        "unrelated or ambiguous pruning",
      );
    },
  );

  it.each([
    "running writer",
    "missing writer",
    "retained ingress",
    "wrong canonical route",
    "ambiguous canonical route",
  ])("requires the complete cutover render with no %s", async (change) => {
    const f = fixture();
    if (change === "running writer") f.writers[0]!.spec.replicas = 1;
    if (change === "missing writer") f.writers.pop();
    if (change === "retained ingress") f.extraDesired.push(ingress("bazarr"));
    if (change === "wrong canonical route")
      f.tunnel.subjects[0]!.name = "media-seerr-service";
    if (change === "ambiguous canonical route") f.extraDesired.push(f.tunnel);
    await expect(credentialSyncPrunes(f.selection, f.read)).rejects.toThrow(
      "exact Media ingress retirement",
    );
    expect(f.reads.some((path) => path.includes("/resource?"))).toBe(false);
  });

  it.each([
    "uid",
    "class",
    "backend",
    "port",
    "finalizers",
    "tracking",
    "hook",
    "prune exclusion",
    "deleting",
    "owner",
  ])("refuses a changed native ingress %s", async (change) => {
    const f = fixture();
    const native = f.native.get("media-bazarr-tailscale-ingress-ingress")!;
    if (change === "uid") native.metadata.uid = "replacement";
    if (change === "class") native.spec.ingressClassName = "public";
    if (change === "backend") native.spec.defaultBackend.service.name = "other";
    if (change === "port")
      native.spec.defaultBackend.service.port.number = 8081;
    if (change === "finalizers")
      native.metadata.finalizers.push("foreign/finalizer");
    if (change === "tracking")
      native.metadata.annotations["argocd.argoproj.io/tracking-id"] = "other";
    if (change === "hook")
      native.metadata.annotations["argocd.argoproj.io/hook"] = "PreSync";
    if (change === "prune exclusion")
      native.metadata.annotations["argocd.argoproj.io/sync-options"] =
        "Prune=confirm";
    if (change === "deleting")
      Object.assign(native.metadata, {
        deletionTimestamp: "2026-11-21T00:00:00Z",
      });
    if (change === "owner")
      Object.assign(native.metadata, { ownerReferences: [{ uid: "other" }] });
    await expect(credentialSyncPrunes(f.selection, f.read)).rejects.toThrow(
      /changed before sync|exact owned resource/u,
    );
  });

  it("refuses a duplicate managed identity and an Application that starts another operation", async () => {
    const duplicate = fixture();
    duplicate.managed.push(duplicate.managed[0]!);
    await expect(
      credentialSyncPrunes(duplicate.selection, duplicate.read),
    ).rejects.toThrow("unrelated or ambiguous pruning");

    const competing = fixture();
    competing.after.operation = { sync: { prune: true } };
    await expect(
      credentialSyncPrunes(competing.selection, competing.read),
    ).rejects.toThrow("settled Application operation");
  });
});
