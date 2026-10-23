import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import {
  Certificate,
  ClusterIssuer,
  Issuer,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/cert-manager.io.ts";
import {
  ARGOCD_SYNC_OPTIONS_ANNOTATION,
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_LIFECYCLE_ANNOTATION,
  APPLICATION_RESOURCES_FINALIZER,
  APPLICATION_SYNC_WAVES,
  MANAGED_APPLICATION_LABEL,
  applyApplicationReleasePolicy,
} from "./application-release-policy.ts";

const ManifestSchema = z.object({
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()),
    labels: z.record(z.string(), z.string()).optional(),
    finalizers: z.array(z.string()).optional(),
  }),
  spec: z.object({
    syncPolicy: z
      .object({
        automated: z.unknown().optional(),
      })
      .optional(),
  }),
});

const WaveAnnotationSchema = z.object({
  metadata: z.object({
    annotations: z.record(z.string(), z.string()),
  }),
});

function application(
  chart: Chart,
  name: string,
  annotations?: Record<string, string>,
): Application {
  return new Application(chart, `${name}-construct`, {
    metadata: { name, annotations },
    spec: {
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.sjer.red",
        targetRevision: "1.0.0",
        chart: name,
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "default",
      },
      syncPolicy: { automated: {} },
    },
  });
}

describe("applyApplicationReleasePolicy", () => {
  test("delegated upstream charts need no root-owned build revision", () => {
    const previous = Bun.env["HOMELAB_CHART_REVISIONS_JSON"];
    try {
      Bun.env["HOMELAB_CHART_REVISIONS_JSON"] = "{}";
      const app = new App();
      const chart = new Chart(app, "apps");
      const delegated = new Application(chart, "minecraft", {
        metadata: {
          name: "minecraft-tsmc",
          annotations: {
            "delivery.shepherdjerred.com/environment": "minecraft/tsmc",
          },
        },
        spec: {
          project: "default",
          source: {
            repoUrl: "https://chartmuseum.sjer.red",
            chart: "minecraft",
            targetRevision: "5.2.0",
            helm: {
              parameters: [
                {
                  name: "image.tag",
                  value: "selected@sha256:" + "a".repeat(64),
                },
              ],
            },
          },
          destination: {
            server: "https://kubernetes.default.svc",
            namespace: "minecraft-tsmc",
          },
          syncPolicy: { automated: {} },
        },
      });
      expect(() => applyApplicationReleasePolicy(app)).not.toThrow();
      expect(
        z
          .object({
            spec: z.object({
              source: z.object({ targetRevision: z.string() }),
            }),
          })
          .parse(delegated.toJson()).spec.source.targetRevision,
      ).toBe("5.2.0");
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(Bun.env, "HOMELAB_CHART_REVISIONS_JSON");
      else Bun.env["HOMELAB_CHART_REVISIONS_JSON"] = previous;
    }
  });

  test("adds cascading finalizers and explicit retain exceptions", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    const worker = application(chart, "worker");
    const root = application(chart, "apps");
    applyApplicationReleasePolicy(app, false);

    const workerManifest = ManifestSchema.parse(worker.toJson());
    expect(
      workerManifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
    ).toBe("cascade");
    expect(workerManifest.metadata.finalizers).toEqual([
      APPLICATION_RESOURCES_FINALIZER,
    ]);
    expect(workerManifest.metadata.labels?.[MANAGED_APPLICATION_LABEL]).toBe(
      "true",
    );
    expect(
      workerManifest.metadata.annotations[ARGOCD_SYNC_WAVE_ANNOTATION],
    ).toBe("4");
    expect(workerManifest.spec.syncPolicy?.automated).toEqual({
      enabled: false,
    });

    const rootManifest = ManifestSchema.parse(root.toJson());
    expect(
      rootManifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
    ).toBe("retain");
    expect(rootManifest.metadata.finalizers).toBeUndefined();
    expect(
      rootManifest.metadata.labels?.[MANAGED_APPLICATION_LABEL],
    ).toBeUndefined();
    // The root Application deliberately shares the structural wave: the final
    // full-source release operation proves this apply and its prunes without
    // waiting on later-wave child health.
    expect(rootManifest.metadata.annotations[ARGOCD_SYNC_WAVE_ANNOTATION]).toBe(
      APPLICATION_SYNC_WAVES.structural,
    );
    expect(rootManifest.spec.syncPolicy?.automated).toEqual({
      enabled: false,
    });
  });

  test("orders providers, controllers, dependencies, and leaf Applications", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    const expectedWaves = new Map([
      ["1password", "-20"],
      ["argocd", "-18"],
      ["postgres-operator", "-18"],
      ["tailscale", "-18"],
      ["prometheus", "-1"],
      ["alert-dashboard", "-1"],
      ["trmnl-dashboard", "-1"],
      ["temporal", "0"],
      ["kueue", "1"],
      ["woodpecker", "3"],
      ["scout-beta", "4"],
      ["scout-prod", "4"],
      ["grafana-db", "4"],
      ["bugsink", "4"],
      ["phoenix", "4"],
      ["worker", "4"],
    ]);
    const applications = [...expectedWaves.keys()].map((name) =>
      application(chart, name),
    );

    applyApplicationReleasePolicy(app);

    for (const resource of applications) {
      const manifest = ManifestSchema.parse(resource.toJson());
      expect(manifest.metadata.annotations[ARGOCD_SYNC_WAVE_ANNOTATION]).toBe(
        expectedWaves.get(manifest.metadata.name),
      );
    }
  });

  test("orders the cluster CA before ClusterIssuer and leaves it signs", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    const selfSigned = new Issuer(chart, "self-signed", {
      metadata: { name: "cert-manager-self-signed", namespace: "cert-manager" },
      spec: { selfSigned: {} },
    });
    const ca = new Certificate(chart, "cluster-ca", {
      metadata: { name: "homelab-cluster-ca", namespace: "cert-manager" },
      spec: {
        secretName: "homelab-cluster-ca",
        isCa: true,
        issuerRef: { name: "cert-manager-self-signed", kind: "Issuer" },
      },
    });
    const clusterIssuer = new ClusterIssuer(chart, "cluster-issuer", {
      metadata: { name: "homelab-ca-issuer" },
      spec: { ca: { secretName: "homelab-cluster-ca" } },
    });
    const leaf = new Certificate(chart, "leaf", {
      metadata: { name: "postal-smtp-tls", namespace: "postal" },
      spec: {
        secretName: "postal-smtp-tls",
        issuerRef: { name: "homelab-ca-issuer", kind: "ClusterIssuer" },
      },
    });

    applyApplicationReleasePolicy(app);

    expect(
      WaveAnnotationSchema.parse(selfSigned.toJson()).metadata.annotations[
        ARGOCD_SYNC_WAVE_ANNOTATION
      ],
    ).toBe("-5");
    expect(
      WaveAnnotationSchema.parse(ca.toJson()).metadata.annotations[
        ARGOCD_SYNC_WAVE_ANNOTATION
      ],
    ).toBe("-4");
    expect(
      WaveAnnotationSchema.parse(clusterIssuer.toJson()).metadata.annotations[
        ARGOCD_SYNC_WAVE_ANNOTATION
      ],
    ).toBe("-3");
    expect(
      WaveAnnotationSchema.parse(leaf.toJson()).metadata.annotations[
        ARGOCD_SYNC_WAVE_ANNOTATION
      ],
    ).toBe("-2");
  });
});

describe("transition rendering", () => {
  test("retains root children with Prune=false and no finalizer", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    const worker = application(chart, "worker");
    const declared = application(chart, "declared", {
      [ARGOCD_SYNC_OPTIONS_ANNOTATION]: "ServerSideApply=true",
    });
    const argocd = application(chart, "argocd");
    const root = application(chart, "apps");
    const nested = application(new Chart(app, "other"), "nested");
    applyApplicationReleasePolicy(app, true);

    for (const child of [worker, declared]) {
      const manifest = ManifestSchema.parse(child.toJson());
      expect(
        manifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
      ).toBe("retain");
      expect(manifest.metadata.finalizers).toBeUndefined();
      expect(manifest.metadata.labels?.[MANAGED_APPLICATION_LABEL]).toBe(
        "true",
      );
      expect(manifest.spec.syncPolicy?.automated).toEqual({
        enabled: false,
      });
    }
    expect(
      ManifestSchema.parse(worker.toJson()).metadata.annotations[
        ARGOCD_SYNC_OPTIONS_ANNOTATION
      ],
    ).toBe("Prune=false");
    expect(
      ManifestSchema.parse(declared.toJson()).metadata.annotations[
        ARGOCD_SYNC_OPTIONS_ANNOTATION
      ],
    ).toBe("ServerSideApply=true,Prune=false");

    // The retained root and ArgoCD Applications render exactly as before.
    for (const retained of [argocd, root]) {
      const manifest = ManifestSchema.parse(retained.toJson());
      expect(
        manifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
      ).toBe("retain");
      expect(manifest.metadata.finalizers).toBeUndefined();
      expect(manifest.metadata.annotations).not.toHaveProperty(
        ARGOCD_SYNC_OPTIONS_ANNOTATION,
      );
    }

    // Only the root's own children change; other charts keep cascading.
    const nestedManifest = ManifestSchema.parse(nested.toJson());
    expect(
      nestedManifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
    ).toBe("cascade");
    expect(nestedManifest.metadata.finalizers).toEqual([
      APPLICATION_RESOURCES_FINALIZER,
    ]);
    expect(nestedManifest.metadata.annotations).not.toHaveProperty(
      ARGOCD_SYNC_OPTIONS_ANNOTATION,
    );
  });

  test("refuses a child that declares pruning", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    application(chart, "worker", {
      [ARGOCD_SYNC_OPTIONS_ANNOTATION]: "Prune=true",
    });
    expect(() => applyApplicationReleasePolicy(app, true)).toThrow(
      /Prune=true, which conflicts with Prune=false/u,
    );
  });

  test("is idempotent for already stamped children", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    const worker = application(chart, "worker", {
      [ARGOCD_SYNC_OPTIONS_ANNOTATION]: "Prune=false",
    });
    applyApplicationReleasePolicy(app, true);
    expect(
      ManifestSchema.parse(worker.toJson()).metadata.annotations[
        ARGOCD_SYNC_OPTIONS_ANNOTATION
      ],
    ).toBe("Prune=false");
  });

  test("off keeps cascading finalizers on root children", () => {
    const app = new App();
    const chart = new Chart(app, "apps");
    const worker = application(chart, "worker");
    applyApplicationReleasePolicy(app, false);
    const manifest = ManifestSchema.parse(worker.toJson());
    expect(
      manifest.metadata.annotations[APPLICATION_LIFECYCLE_ANNOTATION],
    ).toBe("cascade");
    expect(manifest.metadata.finalizers).toEqual([
      APPLICATION_RESOURCES_FINALIZER,
    ]);
    expect(manifest.metadata.annotations).not.toHaveProperty(
      ARGOCD_SYNC_OPTIONS_ANNOTATION,
    );
  });
});
