import { describe, expect, test } from "bun:test";
import { analyzeApplySafety } from "./argocd-apply-safety.ts";

function state(value: unknown): string {
  return JSON.stringify(value);
}

function database(volumeClaimTemplates: readonly unknown[]): string {
  return state({
    spec: {
      serviceName: "db",
      selector: { matchLabels: { app: "db" } },
      volumeClaimTemplates,
    },
  });
}

// Exactly what a chart declares for a claim template: no API-populated keys.
const declaredClaim = {
  metadata: { name: "data" },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: { requests: { storage: "8Gi" } },
  },
};

describe("ArgoCD apply safety", () => {
  test("reports immutable StatefulSet template changes", () => {
    const findings = analyzeApplySafety([
      {
        group: "apps",
        kind: "StatefulSet",
        namespace: "loki",
        name: "loki",
        liveState: state({
          spec: {
            serviceName: "loki",
            selector: { matchLabels: { app: "loki" } },
            volumeClaimTemplates: [{ metadata: { name: "data" } }],
          },
        }),
        targetState: state({
          spec: {
            serviceName: "loki",
            selector: { matchLabels: { app: "loki" } },
            volumeClaimTemplates: [{ metadata: { name: "storage" } }],
          },
        }),
      },
    ]);
    expect(findings).toEqual([
      "apps/StatefulSet loki/loki changes immutable /spec/volumeClaimTemplates",
    ]);
  });

  test("reports an immutable DaemonSet selector change", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "DaemonSet",
          namespace: "observability",
          name: "alloy",
          liveState: state({
            spec: { selector: { matchLabels: { app: "alloy" } } },
          }),
          targetState: state({
            spec: { selector: { matchLabels: { app: "alloy-logs" } } },
          }),
        },
      ]),
    ).toEqual([
      "apps/DaemonSet observability/alloy changes immutable /spec/selector",
    ]);
  });

  test("reports an immutable StatefulSet pod management change", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "media",
          name: "index",
          liveState: state({ spec: { podManagementPolicy: "OrderedReady" } }),
          targetState: state({ spec: { podManagementPolicy: "Parallel" } }),
        },
        // The API server defaults this field, so a chart that leaves it out is
        // not declaring a change and must not be reported.
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "media",
          name: "cache",
          liveState: state({ spec: { podManagementPolicy: "OrderedReady" } }),
          targetState: state({ spec: { replicas: 2 } }),
        },
      ]),
    ).toEqual([
      "apps/StatefulSet media/index changes immutable /spec/podManagementPolicy",
    ]);
  });

  test("reports immutable PersistentVolumeClaim selector changes", () => {
    expect(
      analyzeApplySafety([
        {
          kind: "PersistentVolumeClaim",
          namespace: "media",
          name: "changed",
          liveState: state({
            spec: { selector: { matchLabels: { tier: "hot" } } },
          }),
          targetState: state({
            spec: { selector: { matchLabels: { tier: "cold" } } },
          }),
        },
        {
          kind: "PersistentVolumeClaim",
          namespace: "media",
          name: "dropped",
          liveState: state({
            spec: {
              selector: { matchLabels: { tier: "hot" } },
              volumeMode: "Filesystem",
            },
          }),
          targetState: state({ spec: { volumeMode: "Filesystem" } }),
        },
      ]),
    ).toEqual([
      "/PersistentVolumeClaim media/changed changes immutable /spec/selector",
      "/PersistentVolumeClaim media/dropped changes immutable /spec/selector",
    ]);
  });

  test("allows mutable changes and newly created resources", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "Deployment",
          namespace: "test",
          name: "api",
          liveState: state({
            spec: {
              replicas: 1,
              selector: { matchLabels: { app: "api" } },
            },
          }),
          targetState: state({
            spec: {
              replicas: 2,
              selector: { matchLabels: { app: "api" } },
            },
          }),
        },
        { kind: "Service", name: "new", targetState: state({ spec: {} }) },
      ]),
    ).toEqual([]);
  });

  test("ignores API-defaulted fields inside an immutable template", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "test",
          name: "db",
          liveState: database([
            {
              ...declaredClaim,
              spec: { ...declaredClaim.spec, volumeMode: "Filesystem" },
            },
          ]),
          targetState: database([declaredClaim]),
        },
      ]),
    ).toEqual([]);
  });
});

// Dropping a key *inside* a declared immutable field is as rejectable as
// changing one, but comparing only the target's keys reported it as no change.
describe("ArgoCD immutable nested key removal", () => {
  test("reports a selector label removed from the declaration", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "DaemonSet",
          namespace: "observability",
          name: "alloy",
          liveState: state({
            spec: { selector: { matchLabels: { app: "alloy", tier: "logs" } } },
          }),
          targetState: state({
            spec: { selector: { matchLabels: { app: "alloy" } } },
          }),
        },
        {
          kind: "PersistentVolumeClaim",
          namespace: "media",
          name: "data",
          liveState: state({
            spec: { selector: { matchLabels: { tier: "hot", zone: "a" } } },
          }),
          targetState: state({
            spec: { selector: { matchLabels: { tier: "hot" } } },
          }),
        },
      ]),
    ).toEqual([
      "apps/DaemonSet observability/alloy changes immutable /spec/selector",
      "/PersistentVolumeClaim media/data changes immutable /spec/selector",
    ]);
  });

  test("reports a matchExpressions entry removed from a selector", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "Deployment",
          namespace: "media",
          name: "relay",
          liveState: state({
            spec: {
              selector: {
                matchLabels: { app: "relay" },
                matchExpressions: [
                  { key: "tier", operator: "In", values: ["hot"] },
                ],
              },
            },
          }),
          targetState: state({
            spec: { selector: { matchLabels: { app: "relay" } } },
          }),
        },
      ]),
    ).toEqual(["apps/Deployment media/relay changes immutable /spec/selector"]);
  });

  // The opposite classification: the API server owns keys inside a claim
  // template, so a live-only key there is its doing and must stay silent even
  // though the identical shape is a finding for a selector.
  test("ignores API-populated keys nested deep inside a claim template", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "test",
          name: "db",
          liveState: database([
            {
              ...declaredClaim,
              metadata: {
                ...declaredClaim.metadata,
                creationTimestamp: null,
              },
              spec: {
                ...declaredClaim.spec,
                volumeMode: "Filesystem",
                storageClassName: "zfs-ssd",
                resources: {
                  requests: { storage: "8Gi" },
                  limits: { storage: "8Gi" },
                },
              },
            },
          ]),
          targetState: database([declaredClaim]),
        },
      ]),
    ).toEqual([]);
  });
});

// A claim template is a PersistentVolumeClaim, so the same author-owned keys
// are immutable inside it. The enclosing list has to tolerate live-only keys
// because the API server writes them into every template, which is exactly what
// would otherwise hide a key the author removed from one.
describe("ArgoCD immutable keys inside a claim template", () => {
  test("reports an author-owned key dropped from a claim template", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "test",
          name: "db",
          liveState: database([
            {
              ...declaredClaim,
              spec: {
                ...declaredClaim.spec,
                volumeMode: "Filesystem",
                storageClassName: "zfs-ssd",
              },
            },
          ]),
          targetState: database([
            {
              ...declaredClaim,
              spec: { resources: { requests: { storage: "8Gi" } } },
            },
          ]),
        },
      ]),
    ).toEqual([
      "apps/StatefulSet test/db changes immutable /spec/volumeClaimTemplates/[name=data]/spec/accessModes",
    ]);
  });

  test("reports a selector label removed inside a claim template", () => {
    const selected = {
      ...declaredClaim,
      spec: {
        ...declaredClaim.spec,
        selector: { matchLabels: { tier: "hot", zone: "a" } },
      },
    };
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "test",
          name: "db",
          liveState: database([selected]),
          targetState: database([
            {
              ...selected,
              spec: {
                ...selected.spec,
                selector: { matchLabels: { tier: "hot" } },
              },
            },
          ]),
        },
      ]),
      // The enclosing list tolerates live-only keys, so it stays silent here
      // and the finding names the exact template and field instead.
    ).toEqual([
      "apps/StatefulSet test/db changes immutable /spec/volumeClaimTemplates/[name=data]/spec/selector",
    ]);
  });

  // The tolerance that makes the gap possible must survive: a template carrying
  // only API-populated additions is still not a declared change.
  test("ignores a template that differs only by API-populated keys", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "test",
          name: "db",
          liveState: database([
            {
              ...declaredClaim,
              spec: {
                ...declaredClaim.spec,
                volumeMode: "Filesystem",
                storageClassName: "zfs-ssd",
                volumeName: "pvc-123",
              },
            },
          ]),
          targetState: database([declaredClaim]),
        },
      ]),
    ).toEqual([]);
  });
});

// Omitting an immutable field means something different for each kind of
// field, so these cover all three: reset to default, removal of an
// author-owned field, and a server-assigned value the request never sets.
describe("ArgoCD immutable field omission", () => {
  test("reports dropping a non-default immutable field", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "media",
          name: "index",
          // Omitting the field resets it toward OrderedReady, which the API
          // server rejects just as it rejects an explicit change.
          liveState: state({ spec: { podManagementPolicy: "Parallel" } }),
          targetState: state({ spec: { replicas: 2 } }),
        },
        {
          kind: "PersistentVolumeClaim",
          namespace: "media",
          name: "blocks",
          liveState: state({
            spec: { accessModes: ["ReadWriteOnce"], volumeMode: "Block" },
          }),
          targetState: state({ spec: { accessModes: ["ReadWriteOnce"] } }),
        },
      ]),
    ).toEqual([
      "apps/StatefulSet media/index changes immutable /spec/podManagementPolicy",
      "/PersistentVolumeClaim media/blocks changes immutable /spec/volumeMode",
    ]);
  });

  test("reports removing an author-owned immutable field", () => {
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "media",
          name: "index",
          // Nothing defaults serviceName, so dropping it removes a managed
          // immutable field rather than resetting it.
          liveState: state({ spec: { serviceName: "index", replicas: 1 } }),
          targetState: state({ spec: { replicas: 2 } }),
        },
        {
          group: "apps",
          kind: "Deployment",
          namespace: "media",
          name: "relay",
          liveState: state({ spec: { selector: { matchLabels: { a: "b" } } } }),
          targetState: state({ spec: { replicas: 2 } }),
        },
      ]),
    ).toEqual([
      "apps/StatefulSet media/index changes immutable /spec/serviceName",
      "apps/Deployment media/relay changes immutable /spec/selector",
    ]);
  });

  test("ignores server-assigned immutable fields omitted by the target", () => {
    expect(
      analyzeApplySafety([
        {
          kind: "Service",
          namespace: "test",
          name: "api",
          liveState: state({
            spec: {
              clusterIP: "10.96.0.10",
              clusterIPs: ["10.96.0.10"],
              ipFamilies: ["IPv4"],
            },
          }),
          targetState: state({ spec: { ports: [{ port: 80 }] } }),
        },
        {
          kind: "PersistentVolumeClaim",
          namespace: "test",
          name: "data",
          liveState: state({
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: "zfs-ssd",
              volumeMode: "Filesystem",
              volumeName: "pvc-123",
            },
          }),
          targetState: state({
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: "zfs-ssd",
              volumeMode: "Filesystem",
            },
          }),
        },
      ]),
    ).toEqual([]);
  });
});

function relayDeployment(
  liveContainers: readonly unknown[],
  targetContainers: readonly unknown[],
) {
  return {
    group: "apps",
    kind: "Deployment",
    namespace: "media",
    name: "relay",
    liveState: state({
      spec: { template: { spec: { containers: liveContainers } } },
    }),
    targetState: state({
      spec: { template: { spec: { containers: targetContainers } } },
    }),
  };
}

describe("ArgoCD probe handler safety", () => {
  test("reports mutually exclusive probe handler swaps", () => {
    expect(
      analyzeApplySafety([
        relayDeployment(
          [{ name: "relay", livenessProbe: { httpGet: { path: "/" } } }],
          [{ name: "relay", livenessProbe: { tcpSocket: { port: 80 } } }],
        ),
      ]),
    ).toEqual([
      "apps/Deployment media/relay changes /spec/template/spec/containers/[name=relay]/livenessProbe handler from httpGet to tcpSocket; use a resource-scoped replace",
    ]);
  });

  test("correlates probe handlers across reordered containers", () => {
    const relay = { name: "relay", livenessProbe: { httpGet: { path: "/" } } };
    const sidecar = {
      name: "sidecar",
      livenessProbe: { tcpSocket: { port: 9 } },
    };
    expect(
      analyzeApplySafety([relayDeployment([relay, sidecar], [sidecar, relay])]),
    ).toEqual([]);
  });

  test("reports a probe handler swap beside an inserted container", () => {
    expect(
      analyzeApplySafety([
        relayDeployment(
          [{ name: "relay", livenessProbe: { httpGet: { path: "/" } } }],
          [
            { name: "proxy", livenessProbe: { httpGet: { path: "/" } } },
            { name: "relay", livenessProbe: { tcpSocket: { port: 80 } } },
          ],
        ),
      ]),
    ).toEqual([
      "apps/Deployment media/relay changes /spec/template/spec/containers/[name=relay]/livenessProbe handler from httpGet to tcpSocket; use a resource-scoped replace",
    ]);
  });
});
