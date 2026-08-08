import { describe, expect, it } from "bun:test";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createPlaneChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/plane.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createPlaneApp, createPlaneInfrastructureApp } from "./plane.ts";

const PlaneApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({
    name: z.literal("plane-enterprise"),
  }),
  spec: z.object({
    source: z.object({
      repoURL: z.literal("https://helm.plane.so/"),
      chart: z.literal("plane-enterprise"),
      targetRevision: z.literal(versions["plane-enterprise"]),
      helm: z.object({
        releaseName: z.literal("plane"),
        valuesObject: z
          .object({
            planeVersion: z.literal(versions["plane-enterprise-app"]),
            license: z.object({
              licenseServer: z.literal("https://prime.plane.so"),
              licenseDomain: z.literal("plane.tailnet-1a49.ts.net"),
            }),
            ingress: z.object({ enabled: z.literal(false) }),
            services: z.object({
              redis: z.object({ local_setup: z.literal(true) }),
              postgres: z.object({ local_setup: z.literal(true) }),
              rabbitmq: z.object({ local_setup: z.literal(true) }),
              opensearch: z.object({ local_setup: z.literal(false) }),
              minio: z.object({ local_setup: z.literal(false) }),
              pi: z.object({ enabled: z.literal(false) }),
              runner: z.object({ enabled: z.literal(false) }),
            }),
            external_secrets: z.object({
              rabbitmq_existingSecret: z.literal("plane-secrets"),
              pgdb_existingSecret: z.literal("plane-secrets"),
              doc_store_existingSecret: z.literal("plane-secrets"),
              app_env_existingSecret: z.literal("plane-secrets"),
              live_env_existingSecret: z.literal("plane-secrets"),
              silo_env_existingSecret: z.literal("plane-secrets"),
            }),
            env: z.object({
              storageClass: z.literal("zfs-ssd"),
              docstore_bucket: z.literal("plane-attachments"),
              storage_provider: z.literal("S3"),
              aws_s3_endpoint_url: z.literal(
                "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
              ),
              use_storage_proxy: z.literal(true),
              web_url: z.literal("https://plane.tailnet-1a49.ts.net"),
            }),
          })
          .loose(),
      }),
    }),
    destination: z.object({ namespace: z.literal("plane") }),
    syncPolicy: z.object({
      automated: z.object({}),
      syncOptions: z.array(z.literal("CreateNamespace=true")),
    }),
  }),
});

const PlaneInfrastructureApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({
    name: z.literal("plane"),
  }),
  spec: z.object({
    source: z.object({
      repoURL: z.literal("https://chartmuseum.tailnet-1a49.ts.net"),
      chart: z.literal("plane"),
    }),
  }),
});

const InfrastructureSecretSchema = z.object({
  kind: z.literal("OnePasswordItem"),
  metadata: z.object({
    name: z.literal("plane-secrets"),
    namespace: z.literal("plane"),
  }),
  spec: z.object({
    itemPath: z.literal(
      "vaults/v64ocnykdqju4ui6j6pua56xw4/items/plane-commercial-secrets",
    ),
  }),
});

const PlaneNamespaceSchema = z.object({
  kind: z.literal("Namespace"),
  metadata: z.object({
    name: z.literal("plane"),
    labels: z.object({
      "pod-security.kubernetes.io/enforce": z.literal("privileged"),
      "pod-security.kubernetes.io/audit": z.literal("restricted"),
      "pod-security.kubernetes.io/warn": z.literal("restricted"),
    }),
  }),
});

const IngressSchema = z.object({
  kind: z.literal("Ingress"),
  metadata: z.object({
    name: z.literal("plane-ingress"),
    namespace: z.literal("plane"),
    annotations: z.undefined().optional(),
  }),
  spec: z.object({
    ingressClassName: z.literal("tailscale"),
    tls: z.array(z.object({ hosts: z.array(z.literal("plane")) })),
    rules: z.array(
      z.object({
        http: z.object({
          paths: z.array(
            z.object({
              path: z.string(),
              backend: z.object({
                service: z.object({
                  name: z.string(),
                  port: z.object({ number: z.number() }),
                }),
              }),
            }),
          ),
        }),
      }),
    ),
  }),
});

describe("Plane Commercial deployment", () => {
  it("pins the vendor chart and configures private issue tracking", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createPlaneInfrastructureApp(chart);
    createPlaneApp(chart);

    const documents = parseAllDocuments(app.synthYaml()).map((document) =>
      document.toJS(),
    );
    const manifest = documents
      .map((document) => PlaneApplicationSchema.safeParse(document))
      .find((result) => result.success);
    const infrastructure = documents
      .map((document) =>
        PlaneInfrastructureApplicationSchema.safeParse(document),
      )
      .find((result) => result.success);
    if (!manifest?.success || !infrastructure?.success) {
      throw new Error("Plane Applications were not synthesized");
    }

    expect(manifest.data.spec.destination.namespace).toBe("plane");
    expect(manifest.data.spec.source.helm.valuesObject).not.toHaveProperty(
      "ssl",
    );
    expect(manifest.data.spec.syncPolicy.syncOptions).toEqual([
      "CreateNamespace=true",
    ]);
    expect(manifest.data.metadata.name).toBe("plane-enterprise");
    expect(infrastructure.data.metadata.name).toBe("plane");
  });

  it("creates the secret bridge and Tailscale-only route map", () => {
    const app = new App();
    createPlaneChart(app);

    const documents = parseAllDocuments(app.synthYaml()).map((document) =>
      document.toJS(),
    );
    const secret = documents
      .map((document) => InfrastructureSecretSchema.safeParse(document))
      .find((result) => result.success);
    const namespace = documents
      .map((document) => PlaneNamespaceSchema.safeParse(document))
      .find((result) => result.success);
    const ingress = documents
      .map((document) => IngressSchema.safeParse(document))
      .find((result) => result.success);
    if (!secret?.success || !namespace?.success || !ingress?.success) {
      throw new Error("Plane infrastructure resources were not synthesized");
    }

    expect(secret.data.spec.itemPath).toContain("plane-commercial-secrets");
    expect(namespace.data.metadata.labels).toEqual({
      "pod-security.kubernetes.io/enforce": "privileged",
      "pod-security.kubernetes.io/audit": "restricted",
      "pod-security.kubernetes.io/warn": "restricted",
    });
    expect(
      ingress.data.spec.rules[0]?.http.paths.map((path) => path.path),
    ).toEqual([
      "/spaces/",
      "/god-mode/",
      "/api/",
      "/auth/",
      "/graphql/",
      "/marketplace/",
      "/live/",
      "/silo/",
      "/",
    ]);
    expect(ingress.data.spec.rules[0]?.http.paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/api/",
          backend: expect.objectContaining({
            service: expect.objectContaining({
              name: "plane-api",
              port: { number: 8000 },
            }),
          }),
        }),
        expect.objectContaining({
          path: "/",
          backend: expect.objectContaining({
            service: expect.objectContaining({
              name: "plane-web",
              port: { number: 3000 },
            }),
          }),
        }),
      ]),
    );
  });
});
