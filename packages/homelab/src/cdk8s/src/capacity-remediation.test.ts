import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { rm } from "node:fs/promises";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { setupCharts } from "./setup-charts.ts";

const SYNTH_OUTDIR = ".test-synth-capacity-remediation";

const IdentitySchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string(), namespace: z.string().optional() }),
});

const ApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    source: z.object({
      helm: z.object({ valuesObject: z.unknown() }),
    }),
  }),
});

function applicationValues(
  documents: readonly unknown[],
  name: string,
): unknown {
  for (const document of documents) {
    const result = ApplicationSchema.safeParse(document);
    if (result.success && result.data.metadata.name === name) {
      return result.data.spec.source.helm.valuesObject;
    }
  }
  throw new Error(`missing Application ${name}`);
}

function assertTempoAndLoki(documents: readonly unknown[]): void {
  const tempo = z
    .object({
      tempo: z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("1"),
            memory: z.literal("2Gi"),
          }),
        }),
      }),
    })
    .parse(applicationValues(documents, "tempo"));
  expect(tempo.tempo.resources).toEqual({
    requests: { cpu: "1", memory: "2Gi" },
  });

  const loki = z
    .object({
      singleBinary: z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("250m"),
            memory: z.literal("3Gi"),
          }),
          limits: z.object({
            cpu: z.literal("4"),
            memory: z.literal("6Gi"),
          }),
        }),
      }),
      resultsCache: z.object({
        allocatedCPU: z.literal("100m"),
        allocatedMemory: z.literal(256),
      }),
      chunksCache: z.object({
        allocatedCPU: z.literal("100m"),
        allocatedMemory: z.literal(4096),
      }),
      gateway: z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("10m"),
            memory: z.literal("64Mi"),
          }),
        }),
      }),
      sidecar: z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("10m"),
            memory: z.literal("128Mi"),
          }),
        }),
      }),
      memcachedExporter: z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("10m"),
            memory: z.literal("64Mi"),
          }),
        }),
      }),
      lokiCanary: z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("10m"),
            memory: z.literal("64Mi"),
          }),
        }),
      }),
    })
    .parse(applicationValues(documents, "loki"));

  expect(loki.singleBinary.resources).toEqual({
    requests: { cpu: "250m", memory: "3Gi" },
    limits: { cpu: "4", memory: "6Gi" },
  });
  expect(loki.resultsCache).toEqual({
    allocatedCPU: "100m",
    allocatedMemory: 256,
  });
  expect(loki.chunksCache).toEqual({
    allocatedCPU: "100m",
    allocatedMemory: 4096,
  });
}

function assertMonitoringHelpers(documents: readonly unknown[]): void {
  const prometheus = z
    .object({
      prometheusOperator: z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("100m"),
            memory: z.literal("128Mi"),
          }),
        }),
        prometheusConfigReloader: z.object({
          resources: z.object({
            requests: z.object({
              cpu: z.literal("10m"),
              memory: z.literal("64Mi"),
            }),
          }),
        }),
      }),
      "kube-state-metrics": z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("20m"),
            memory: z.literal("128Mi"),
          }),
        }),
      }),
      "prometheus-blackbox-exporter": z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("20m"),
            memory: z.literal("64Mi"),
          }),
        }),
      }),
      "prometheus-node-exporter": z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("10m"),
            memory: z.literal("64Mi"),
          }),
        }),
      }),
      grafana: z.object({
        sidecar: z.object({
          resources: z.object({
            requests: z.object({
              cpu: z.literal("10m"),
              memory: z.literal("128Mi"),
            }),
          }),
        }),
        imageRenderer: z.object({
          resources: z.object({
            requests: z.object({
              cpu: z.literal("50m"),
              memory: z.literal("512Mi"),
            }),
          }),
        }),
      }),
    })
    .parse(applicationValues(documents, "prometheus"));

  expect(prometheus.prometheusOperator.resources).toEqual({
    requests: { cpu: "100m", memory: "128Mi" },
  });
  expect(prometheus.grafana.sidecar.resources).toEqual({
    requests: { cpu: "10m", memory: "128Mi" },
  });

  const adapter = z
    .object({
      resources: z.object({
        requests: z.object({
          cpu: z.literal("20m"),
          memory: z.literal("128Mi"),
        }),
      }),
    })
    .parse(applicationValues(documents, "prometheus-adapter"));
  expect(adapter.resources).toEqual({
    requests: { cpu: "20m", memory: "128Mi" },
  });
}

function assertTailscaleSizing(documents: readonly unknown[]): void {
  const ProxyClassSchema = z.object({
    apiVersion: z.literal("tailscale.com/v1alpha1"),
    kind: z.literal("ProxyClass"),
    metadata: z.object({ name: z.enum(["standard", "medium", "heavy"]) }),
    spec: z.object({
      statefulSet: z.object({
        pod: z.object({
          tailscaleContainer: z.object({
            resources: z.object({
              requests: z.object({ cpu: z.string(), memory: z.string() }),
            }),
          }),
          tailscaleInitContainer: z.object({
            resources: z.object({
              requests: z.object({
                cpu: z.literal("5m"),
                memory: z.literal("16Mi"),
              }),
            }),
          }),
        }),
      }),
    }),
  });
  const proxyClasses = documents.flatMap((document) => {
    const result = ProxyClassSchema.safeParse(document);
    return result.success ? [result.data] : [];
  });
  expect(
    Object.fromEntries(
      proxyClasses.map((proxyClass) => [
        proxyClass.metadata.name,
        proxyClass.spec.statefulSet.pod.tailscaleContainer.resources,
      ]),
    ),
  ).toEqual({
    standard: { requests: { cpu: "20m", memory: "64Mi" } },
    medium: { requests: { cpu: "20m", memory: "128Mi" } },
    heavy: { requests: { cpu: "50m", memory: "256Mi" } },
  });

  const tailscaleValues = z
    .object({
      operatorConfig: z.object({
        resources: z.object({
          requests: z.object({
            cpu: z.literal("50m"),
            memory: z.literal("128Mi"),
          }),
        }),
      }),
      proxyConfig: z.object({ defaultProxyClass: z.literal("standard") }),
    })
    .parse(applicationValues(documents, "tailscale"));
  expect(tailscaleValues.operatorConfig.resources).toEqual({
    requests: { cpu: "50m", memory: "128Mi" },
  });

  const IngressSchema = z.object({
    kind: z.literal("Ingress"),
    metadata: z.object({
      name: z.string(),
      namespace: z.string(),
      labels: z.object({
        "tailscale.com/proxy-class": z.enum(["medium", "heavy"]),
      }),
    }),
  });
  const ingressClasses = Object.fromEntries(
    documents.flatMap((document) => {
      const result = IngressSchema.safeParse(document);
      return result.success
        ? [
            [
              `${result.data.metadata.namespace}/${result.data.metadata.name}`,
              result.data.metadata.labels["tailscale.com/proxy-class"],
            ],
          ]
        : [];
    }),
  );
  expect(ingressClasses).toEqual({
    "argocd/apps-argocd-ingress": "medium",
    "prometheus/apps-alertmanager-ingress": "medium",
    "chartmuseum/apps-chartmuseum-ingress": "heavy",
    "minecraft-tsmc/apps-minecraft-tsmc-bluemap-ingress": "medium",
    "loki/apps-loki-ingress": "medium",
    "seaweedfs/apps-seaweedfs-s3-ingress": "heavy",
    "media/media-bazarr-tailscale-ingress-ingress": "medium",
    "media/media-plex-tailscale-ingress-ingress": "medium",
    "media/media-sonarr-tailscale-ingress-ingress": "medium",
    "media/media-maintainerr-tailscale-ingress-ingress": "medium",
    "pinchtab/pinchtab-pinchtab-tailscale-ingress-ingress": "medium",
    "stash/stash-stash-ingress-ingress": "medium",
    "turbo-cache/turbo-cache-turbo-cache-tailscale-ingress-ingress": "medium",
  });
}

function assertUniqueIdentities(documents: readonly unknown[]): void {
  const identities = documents.flatMap((document) => {
    const result = IdentitySchema.safeParse(document);
    return result.success
      ? [`${result.data.kind}/${result.data.metadata.name}`]
      : [];
  });
  for (const identity of [
    "Application/loki",
    "Application/tempo",
    "Application/tailscale",
  ]) {
    expect(
      identities.filter((candidate) => candidate === identity),
    ).toHaveLength(1);
  }
}

describe("capacity-remediation synthesis", () => {
  let documents: unknown[];

  beforeAll(async () => {
    const app = new App({ outdir: SYNTH_OUTDIR });
    await setupCharts(app);
    documents = parseAllDocuments(app.synthYaml()).map((document): unknown =>
      document.toJS(),
    );
  });

  afterAll(async () => {
    await rm(SYNTH_OUTDIR, { recursive: true, force: true });
  });

  it("keeps Tempo and Loki at the audited resource matrix", () => {
    assertTempoAndLoki(documents);
  });

  it("adds request-only baselines to monitoring helpers", () => {
    assertMonitoringHelpers(documents);
  });

  it("creates request-only Tailscale proxy classes and selects them by ingress", () => {
    assertTailscaleSizing(documents);
  });

  it("synthesizes every asserted resource identity exactly once", () => {
    assertUniqueIdentities(documents);
  });
});
