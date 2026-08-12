import { describe, expect, test } from "bun:test";
import { analyzeApplySafety } from "./argocd-apply-safety.ts";

function state(value: unknown): string {
  return JSON.stringify(value);
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

  test("reports mutually exclusive probe handler swaps", () => {
    const findings = analyzeApplySafety([
      {
        group: "apps",
        kind: "Deployment",
        namespace: "media",
        name: "relay",
        liveState: state({
          spec: {
            selector: { matchLabels: { app: "relay" } },
            template: {
              spec: {
                containers: [
                  { name: "relay", livenessProbe: { httpGet: { path: "/" } } },
                ],
              },
            },
          },
        }),
        targetState: state({
          spec: {
            selector: { matchLabels: { app: "relay" } },
            template: {
              spec: {
                containers: [
                  { name: "relay", livenessProbe: { tcpSocket: { port: 80 } } },
                ],
              },
            },
          },
        }),
      },
    ]);
    expect(findings).toEqual([
      "apps/Deployment media/relay changes /spec/template/spec/containers/0/livenessProbe handler from httpGet to tcpSocket; use a resource-scoped replace",
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
    expect(
      analyzeApplySafety([
        {
          group: "apps",
          kind: "StatefulSet",
          namespace: "test",
          name: "db",
          liveState: state({
            spec: {
              serviceName: "db",
              selector: { matchLabels: { app: "db" } },
              volumeClaimTemplates: [
                {
                  metadata: { name: "data" },
                  spec: {
                    accessModes: ["ReadWriteOnce"],
                    resources: { requests: { storage: "8Gi" } },
                    volumeMode: "Filesystem",
                  },
                },
              ],
            },
          }),
          targetState: state({
            spec: {
              serviceName: "db",
              selector: { matchLabels: { app: "db" } },
              volumeClaimTemplates: [
                {
                  metadata: { name: "data" },
                  spec: {
                    accessModes: ["ReadWriteOnce"],
                    resources: { requests: { storage: "8Gi" } },
                  },
                },
              ],
            },
          }),
        },
      ]),
    ).toEqual([]);
  });
});
