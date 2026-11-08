import { describe, expect, it } from "vitest";
import { credentialSyncPrunes } from "./credential-prune.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";
import type { ManagedResource } from "homelab/scripts/argocd/argocd-apply-safety.ts";

const vault = "vaults/v64ocnykdqju4ui6j6pua56xw4/items/";
const cases = [
  {
    app: "media",
    namespace: "media",
    bindingNamespace: "media",
    environment: "streambot/prod",
    name: "recyclarr-config-homelab",
    item: "fu5ufvg6bx3kkcp7lqi5pmwj2a",
    replacements: [
      {
        name: "recyclarr-radarr-credential",
        itemId: "tvy75zdvgyajf57rvzywc7nqbu",
      },
      {
        name: "recyclarr-sonarr-credential",
        itemId: "ou5byilomqmlx7askklqonyxfi",
      },
    ],
  },
  {
    app: "woodpecker",
    namespace: "woodpecker",
    bindingNamespace: "woodpecker-ci",
    environment: "woodpecker/prod",
    name: "ci-chartmuseum-credentials",
    item: "cnutkdwa7uka5hk3wx5gimyfom",
    replacements: [
      {
        name: "ci-chartmuseum-basic-auth",
        itemId: "wwoism5fsvmbisv4ef47yxqy2i",
      },
    ],
  },
  {
    app: "delivery-control-plane",
    namespace: "temporal",
    bindingNamespace: "delivery-platform-jobs",
    environment: "delivery-control-plane/prod",
    name: "discord-minecraft-credentials",
    item: "q37vet77dfggoqbvu4bqle3gje",
    replacements: [
      {
        name: "discord-minecraft-tsmc-credentials",
        itemId: "yqp25gif2grm5gkg6l44e6vmxy",
      },
    ],
  },
] as const;

function fixture(scope: (typeof cases)[number] = cases[0]) {
  const selection = {
    name: scope.app,
    namespace: scope.namespace,
    environmentId: scope.environment,
    revision: "2.0.0-42",
    source: {
      chart: scope.app,
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      targetRevision: "2.0.0-42",
      helm: { parameters: deliveryArgoParameters({}) },
    },
  };
  const app = {
    metadata: {
      name: scope.app,
      uid: "app-uid",
      resourceVersion: "1",
      annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: scope.environment },
    },
    spec: {
      source: structuredClone(selection.source),
      destination: { namespace: scope.namespace },
      syncPolicy: { automated: { enabled: false } },
    },
    status: { operationState: { phase: "Succeeded", operation: { info: [] } } },
  };
  const native = {
    apiVersion: "onepassword.com/v1",
    kind: "OnePasswordItem",
    metadata: {
      name: scope.name,
      namespace: scope.bindingNamespace,
      uid: "binding-uid",
      finalizers: ["onepassword.com/finalizer.secret"],
      annotations: {
        "argocd.argoproj.io/tracking-id": `${scope.app}:onepassword.com/OnePasswordItem:${scope.bindingNamespace}/${scope.name}`,
      },
    },
    spec: { itemPath: vault + scope.item },
  };
  const desired: unknown[] = scope.replacements.map(({ name, itemId }) => ({
    apiVersion: "onepassword.com/v1",
    kind: "OnePasswordItem",
    metadata: { name, namespace: scope.bindingNamespace },
    spec: { itemPath: vault + itemId },
  }));
  const namespace = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: scope.bindingNamespace },
  };
  desired.push(namespace);
  const managed: ManagedResource[] = [
    {
      group: "onepassword.com",
      kind: "OnePasswordItem",
      name: scope.name,
      namespace: scope.bindingNamespace,
      liveState: JSON.stringify(native),
    },
    {
      group: "",
      kind: "Namespace",
      name: scope.bindingNamespace,
      liveState: JSON.stringify(namespace),
    },
  ];
  const after = structuredClone(app);
  let reads = 0;
  const read = async (path: string): Promise<unknown> => {
    if (path.includes("/manifests?"))
      return { manifests: desired.map((item) => JSON.stringify(item)) };
    if (path.endsWith("/managed-resources")) return { items: managed };
    if (path.includes("/resource?"))
      return { manifest: JSON.stringify(native) };
    return structuredClone(reads++ === 0 ? app : after);
  };
  return { scope, selection, app, after, native, desired, managed, read };
}

describe("credential binding retirement", () => {
  it.each(cases)(
    "permits only $app's retired binding and preserves the operator finalizer",
    async (scope) => {
      const f = fixture(scope);
      await expect(credentialSyncPrunes(f.selection, f.read)).resolves.toBe(
        true,
      );
      expect(f.native.metadata.finalizers).toEqual([
        "onepassword.com/finalizer.secret",
      ]);
      expect(f.app).toEqual(f.after);
    },
  );
  it("leaves other applications and still-declared bindings alone", async () => {
    await expect(
      credentialSyncPrunes(
        { ...fixture().selection, name: "other" },
        async () => {
          throw new Error("Unexpected read");
        },
      ),
    ).resolves.toBe(false);
    const f = fixture();
    f.desired.push(f.native);
    await expect(credentialSyncPrunes(f.selection, f.read)).resolves.toBe(
      false,
    );
  });
  it.each(["chart", "namespace", "environmentId"] as const)(
    "refuses the wrong %s",
    async (key) => {
      const f = fixture();
      await expect(
        credentialSyncPrunes(
          key === "chart"
            ? {
                ...f.selection,
                source: { ...f.selection.source, chart: "foreign" },
              }
            : { ...f.selection, [key]: "foreign" },
          f.read,
        ),
      ).rejects.toThrow("registered scope");
    },
  );
  it.each([
    "PersistentVolumeClaim",
    "Deployment",
    "Secret",
    "Namespace",
    "OnePasswordItem",
  ])("refuses an unrelated obsolete %s", async (kind) => {
    const f = fixture();
    f.managed.push({
      group: "",
      kind,
      name: "foreign",
      namespace: "media",
      liveState: JSON.stringify({ kind }),
    });
    await expect(credentialSyncPrunes(f.selection, f.read)).rejects.toThrow(
      "unrelated or storage",
    );
  });
  it("uses the exact render rather than stale cached target state", async () => {
    const f = fixture();
    f.managed[0]!.targetState = f.managed[0]!.liveState;
    await expect(credentialSyncPrunes(f.selection, f.read)).resolves.toBe(true);
  });
  it.each(["missing", "wrong-owner", "duplicate"])(
    "refuses a %s canonical replacement",
    async (change) => {
      const f = fixture();
      if (change === "missing") f.desired.shift();
      if (change === "wrong-owner")
        f.desired[0] = {
          apiVersion: "onepassword.com/v1",
          kind: "OnePasswordItem",
          metadata: { name: "recyclarr-radarr-credential", namespace: "media" },
          spec: { itemPath: vault + "foreign" },
        };
      if (change === "duplicate") f.desired.push(f.desired[0]);
      await expect(credentialSyncPrunes(f.selection, f.read)).rejects.toThrow(
        "canonical credential",
      );
    },
  );
  it.each(["env", "volume"])(
    "refuses a remaining %s consumer in the frozen chart",
    async (kind) => {
      const f = fixture();
      f.desired.push({
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "old-consumer", namespace: "media" },
        spec:
          kind === "env"
            ? {
                containers: [
                  {
                    env: [
                      {
                        valueFrom: {
                          secretKeyRef: {
                            name: f.scope.name,
                            key: "key",
                            optional: true,
                          },
                        },
                      },
                    ],
                  },
                ],
              }
            : {
                volumes: [
                  {
                    projected: {
                      sources: [{ secret: { name: f.scope.name } }],
                    },
                  },
                ],
              },
      });
      await expect(credentialSyncPrunes(f.selection, f.read)).rejects.toThrow(
        "still consumes",
      );
    },
  );
  it.each([
    "uid",
    "tracking",
    "item",
    "namespace",
    "deleting",
    "hook",
    "finalizer",
    "owner",
    "retained",
  ])("refuses changed native %s", async (change) => {
    const f = fixture();
    if (change === "uid") f.native.metadata.uid = "replacement";
    if (change === "tracking")
      f.native.metadata.annotations["argocd.argoproj.io/tracking-id"] =
        "foreign";
    if (change === "item") f.native.spec.itemPath = vault + "foreign";
    if (change === "namespace")
      Object.assign(f.native.metadata, { namespace: "foreign" });
    if (change === "deleting")
      Object.assign(f.native.metadata, {
        deletionTimestamp: "2026-11-08T00:00:00Z",
      });
    if (change === "hook")
      Object.assign(f.native.metadata.annotations, {
        "argocd.argoproj.io/hook": "Sync",
      });
    if (change === "finalizer")
      f.native.metadata.finalizers.push("other/finalizer");
    if (change === "owner")
      Object.assign(f.native.metadata, { ownerReferences: [{ uid: "other" }] });
    if (change === "retained")
      Object.assign(f.native.metadata.annotations, {
        "argocd.argoproj.io/sync-options": "Prune=false",
      });
    await expect(credentialSyncPrunes(f.selection, f.read)).rejects.toThrow(
      "exact owned",
    );
  });
  it("refuses source changes, replacement Applications and corrupt inventory", async () => {
    const destination = fixture();
    Object.assign(destination.app.spec.destination, { namespace: "foreign" });
    await expect(
      credentialSyncPrunes(destination.selection, destination.read),
    ).rejects.toThrow("destination");
    const initial = fixture();
    initial.app.spec.source.targetRevision = "2.0.0-41";
    await expect(
      credentialSyncPrunes(initial.selection, initial.read),
    ).rejects.toThrow("rendered exact source");
    const changed = fixture();
    changed.after.spec.source.targetRevision = "2.0.0-43";
    await expect(
      credentialSyncPrunes(changed.selection, changed.read),
    ).rejects.toThrow("rendered exact source");
    const replaced = fixture();
    replaced.after.metadata.uid = "replacement";
    await expect(
      credentialSyncPrunes(replaced.selection, replaced.read),
    ).rejects.toThrow("changed before sync");
    const corrupt = fixture();
    corrupt.managed[0]!.liveState = "not-json";
    await expect(
      credentialSyncPrunes(corrupt.selection, corrupt.read),
    ).rejects.toThrow("Could not read liveState");
  });
});
