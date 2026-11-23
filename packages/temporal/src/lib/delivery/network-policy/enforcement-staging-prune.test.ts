import { describe, expect, it } from "vitest";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "homelab/src/delivery-ownership.ts";
import {
  deliveryArgoParameters,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";
import type { ManagedResource } from "homelab/scripts/argocd/argocd-apply-safety.ts";
import { alertDashboardSyncPrunes } from "#lib/delivery/alert-dashboard/prune.ts";
import { credentialSyncPrunes } from "#lib/delivery/credential-prune.ts";
import { forumSyncPrunes } from "#lib/delivery/forum-prune.ts";
import { selectionRelease } from "#lib/delivery/retired-route-prune.ts";
import {
  assertRetiredEnforcementStagingPolicy,
  enforcementStagingNamespace,
} from "./enforcement-staging-prune.ts";

function stagingPolicy(
  application: string,
  namespace: string,
  overrides: {
    uid?: string;
    stage?: string;
    selector?: Record<string, unknown>;
    trackingId?: string;
    syncOptions?: string;
  } = {},
) {
  const name = `enforcement-staging-${namespace}`;
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name,
      namespace,
      uid: overrides.uid ?? `uid-${namespace}`,
      annotations: {
        "argocd.argoproj.io/tracking-id":
          overrides.trackingId ??
          `${application}:networking.k8s.io/NetworkPolicy:${namespace}/${name}`,
        "homelab.sjer.red/enforcement-stage": overrides.stage ?? "enforced",
        ...(overrides.syncOptions === undefined
          ? {}
          : { "argocd.argoproj.io/sync-options": overrides.syncOptions }),
      },
    },
    spec: {
      egress: [{}],
      ingress: [{}],
      podSelector: overrides.selector ?? {
        matchLabels: { "homelab.sjer.red/enforcement-staging": "never" },
      },
      policyTypes: ["Ingress", "Egress"],
    },
  };
}

function stagingManagedResource(
  namespace: string,
  policy: unknown,
): ManagedResource & { namespace: string } {
  return {
    group: "networking.k8s.io",
    kind: "NetworkPolicy",
    namespace,
    name: `enforcement-staging-${namespace}`,
    liveState: JSON.stringify(policy),
  };
}

describe("enforcementStagingNamespace", () => {
  it("recognizes only non-flipt per-namespace enforcement-staging NetworkPolicies", () => {
    expect(
      enforcementStagingNamespace({
        group: "networking.k8s.io",
        kind: "NetworkPolicy",
        namespace: "alert-dashboard",
        name: "enforcement-staging-alert-dashboard",
      }),
    ).toBe("alert-dashboard");
    expect(
      enforcementStagingNamespace(
        {
          group: "networking.k8s.io",
          kind: "NetworkPolicy",
          namespace: "alert-dashboard",
          name: "enforcement-staging-alert-dashboard",
        },
        "other-ns",
      ),
    ).toBeNull();
    expect(
      enforcementStagingNamespace({
        group: "networking.k8s.io",
        kind: "NetworkPolicy",
        namespace: "flipt",
        name: "enforcement-staging-flipt",
      }),
    ).toBeNull();
    expect(
      enforcementStagingNamespace({
        group: "networking.k8s.io",
        kind: "NetworkPolicy",
        namespace: "alert-dashboard",
        name: "enforcement-break-glass-alert-dashboard",
      }),
    ).toBeNull();
  });
});

describe("assertRetiredEnforcementStagingPolicy", () => {
  it("refuses open, pod-selecting, untracked, or still-rendered staging policies", async () => {
    const openPolicy = stagingPolicy("alert-dashboard", "alert-dashboard", {
      stage: "open",
    });
    await expect(
      assertRetiredEnforcementStagingPolicy({
        application: "alert-dashboard",
        resource: stagingManagedResource("alert-dashboard", openPolicy),
        desired: [],
        defaultNamespace: "alert-dashboard",
        read: async () => ({ manifest: JSON.stringify(openPolicy) }),
        seen: new Set(),
      }),
    ).rejects.toThrow("not the exact owned enforced resource");

    const allowAll = stagingPolicy("alert-dashboard", "alert-dashboard", {
      selector: {},
    });
    await expect(
      assertRetiredEnforcementStagingPolicy({
        application: "alert-dashboard",
        resource: stagingManagedResource("alert-dashboard", allowAll),
        desired: [],
        defaultNamespace: "alert-dashboard",
        read: async () => ({ manifest: JSON.stringify(allowAll) }),
        seen: new Set(),
      }),
    ).rejects.toThrow("not an inert enforced NetworkPolicy");

    const valid = stagingPolicy("alert-dashboard", "alert-dashboard");
    await expect(
      assertRetiredEnforcementStagingPolicy({
        application: "alert-dashboard",
        resource: stagingManagedResource("alert-dashboard", valid),
        desired: [
          {
            apiVersion: "networking.k8s.io/v1",
            kind: "NetworkPolicy",
            metadata: { name: "enforcement-staging-alert-dashboard" },
          },
        ],
        defaultNamespace: "alert-dashboard",
        read: async () => ({ manifest: JSON.stringify(valid) }),
        seen: new Set(),
      }),
    ).rejects.toThrow("remains in the selected render");
  });
});

function selectionApp(selection: DeliverySelection, uid: string) {
  const namespace = selection.namespace ?? selection.application;
  const helm = { parameters: deliveryArgoParameters(selection.parameters) };
  return {
    spec: {
      destination: { namespace },
      syncPolicy: { automated: { enabled: false } },
      source: {
        helm,
        targetRevision: selection.revision,
        repoURL: selection.repository,
        chart: selection.chart,
      },
    },
    metadata: {
      uid,
      name: selection.application,
      resourceVersion: "1",
      annotations: {
        [DELIVERY_ENVIRONMENT_ANNOTATION]: selection.environmentId,
      },
    },
  };
}

describe("prune guard integration for Hub and Forum syncs", () => {
  it("allows Hub syncs to prune an inert enforcement-staging policy", async () => {
    const hubPolicy = stagingPolicy("alert-dashboard", "alert-dashboard");
    const hubSelection = {
      application: "alert-dashboard",
      chart: "alert-dashboard",
      namespace: "alert-dashboard",
      environmentId: "ops-dashboard/prod",
      repository: "https://chartmuseum.tailnet-1a49.ts.net",
      revision: "2.0.0-99",
      parameters: {},
    };
    const hubApp = selectionApp(hubSelection, "hub-uid");
    await expect(
      alertDashboardSyncPrunes(selectionRelease(hubSelection), async (path) => {
        if (path.includes("/manifests?")) return { manifests: [] };
        if (path.endsWith("/managed-resources")) {
          return {
            items: [stagingManagedResource("alert-dashboard", hubPolicy)],
          };
        }
        return path.includes("/resource?")
          ? { manifest: JSON.stringify(hubPolicy) }
          : structuredClone(hubApp);
      }),
    ).resolves.toBe(true);
  });

  it("allows Forum syncs to prune its terminal release Job beside enforcement-staging-storm-forum", async () => {
    const oldJobName = `storm-forum-release-${"a".repeat(32)}`;
    const newReleaseId = "b".repeat(32);
    const forumJob = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: oldJobName,
        namespace: "storm-forum",
        uid: "forum-job-uid",
        annotations: {
          "argocd.argoproj.io/tracking-id": `storm-forum:batch/Job:storm-forum/${oldJobName}`,
        },
      },
      status: {
        active: 0,
        conditions: [{ type: "Complete", status: "True" }],
      },
    };
    const forumPolicy = stagingPolicy("storm-forum", "storm-forum");
    const forumSelection = {
      application: "storm-forum",
      chart: "storm-forum",
      namespace: "storm-forum",
      environmentId: "storm-forum/prod",
      repository: "https://chartmuseum.sjer.red",
      revision: "2.0.0-99",
      parameters: { "delivery.releaseId": newReleaseId },
    };
    const forumApp = selectionApp(forumSelection, "forum-uid");
    await expect(
      forumSyncPrunes(forumSelection, async (path) => {
        if (path.includes("/manifests?")) {
          return {
            manifests: [
              JSON.stringify({
                apiVersion: "batch/v1",
                kind: "Job",
                metadata: {
                  name: `storm-forum-release-${newReleaseId}`,
                  namespace: "storm-forum",
                },
              }),
            ],
          };
        }
        if (path.endsWith("/managed-resources")) {
          return {
            items: [
              {
                group: "batch",
                kind: "Job",
                namespace: "storm-forum",
                name: oldJobName,
                liveState: JSON.stringify(forumJob),
              },
              stagingManagedResource("storm-forum", forumPolicy),
            ] satisfies ManagedResource[],
          };
        }
        if (path.endsWith("/resource-tree")) return { nodes: [] };
        if (path.includes("/resource?")) {
          const query = new URLSearchParams(path.split("?")[1]);
          return {
            manifest: JSON.stringify(
              query.get("kind") === "Job" ? forumJob : forumPolicy,
            ),
          };
        }
        return structuredClone(forumApp);
      }),
    ).resolves.toBe(true);
  });
});

describe("prune guard integration for credential syncs", () => {
  it("allows multi-namespace Woodpecker credential syncs to prune staging policies after credential retirement", async () => {
    const wpPolicy = stagingPolicy("woodpecker", "woodpecker");
    const wpCiPolicy = stagingPolicy("woodpecker", "woodpecker-ci");
    const wpSource = {
      chart: "woodpecker",
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      targetRevision: "2.0.0-99",
      helm: { parameters: deliveryArgoParameters({}) },
    };
    const wpApp = {
      metadata: {
        name: "woodpecker",
        uid: "wp-uid",
        annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: "woodpecker/prod" },
      },
      spec: {
        source: structuredClone(wpSource),
        destination: { namespace: "woodpecker" },
      },
      status: {
        operationState: { phase: "Succeeded", operation: { info: [] } },
      },
    };
    await expect(
      credentialSyncPrunes(
        {
          name: "woodpecker",
          namespace: "woodpecker",
          environmentId: "woodpecker/prod",
          revision: "2.0.0-99",
          source: wpSource,
        },
        async (path) => {
          if (path.includes("/manifests?")) {
            return {
              manifests: [
                JSON.stringify({
                  apiVersion: "onepassword.com/v1",
                  kind: "OnePasswordItem",
                  metadata: {
                    name: "ci-chartmuseum-basic-auth",
                    namespace: "woodpecker-ci",
                  },
                  spec: {
                    itemPath:
                      "vaults/v64ocnykdqju4ui6j6pua56xw4/items/wwoism5fsvmbisv4ef47yxqy2i",
                  },
                }),
              ],
            };
          }
          if (path.endsWith("/managed-resources")) {
            return {
              items: [
                stagingManagedResource("woodpecker", wpPolicy),
                stagingManagedResource("woodpecker-ci", wpCiPolicy),
              ],
            };
          }
          if (path.includes("/resource?")) {
            const query = new URLSearchParams(path.split("?")[1]);
            return {
              manifest: JSON.stringify(
                query.get("namespace") === "woodpecker-ci"
                  ? wpCiPolicy
                  : wpPolicy,
              ),
            };
          }
          return structuredClone(wpApp);
        },
      ),
    ).resolves.toBe(true);
  });
});
