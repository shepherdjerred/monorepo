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
    const claim = {
      metadata: { name: "data" },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: "8Gi" } },
      },
    };
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "test",
          name: "db",
          liveState: database([
            { ...claim, spec: { ...claim.spec, volumeMode: "Filesystem" } },
          ]),
          targetState: database([claim]),
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
