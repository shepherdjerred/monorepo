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
