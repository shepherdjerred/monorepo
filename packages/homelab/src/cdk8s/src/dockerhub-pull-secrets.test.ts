import { describe, expect, it } from "vitest";
import { ApiObject, App, Chart } from "cdk8s";
import { z } from "zod";
import {
  attachDockerHubPullSecrets,
  prepareDockerHubPullSecrets,
} from "./dockerhub-pull-secrets.ts";
import { createWoodpeckerCredentialBoundaries } from "./resources/argo-applications/ci/woodpecker-credentials.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "./misc/onepassword-vault.ts";

function fixtures() {
  const app = new App();
  const chart = new Chart(app, "woodpecker", { namespace: "woodpecker" });
  createWoodpeckerCredentialBoundaries(chart);
  new ApiObject(chart, "extension", {
    apiVersion: "apps/v1",
    kind: "Deployment",
    spec: {
      template: {
        spec: {
          containers: [
            {
              image:
                "ghcr.io/shepherdjerred/woodpecker-config-extension:current",
            },
          ],
        },
      },
    },
  });
  return { app, chart };
}

function secrets(app: App) {
  const schema = z
    .object({
      type: z.string(),
      metadata: z.object({ namespace: z.string() }),
      spec: z.object({ itemPath: z.string() }),
    })
    .loose();
  return app.node
    .findAll()
    .filter((node) => ApiObject.isApiObject(node))
    .filter(
      (resource) =>
        resource.kind === "OnePasswordItem" &&
        resource.metadata.name?.startsWith("dockerhub-pull-"),
    )
    .map((resource) => schema.parse(resource.toJson()));
}

describe("Docker Hub templated image readers", () => {
  it("requires a namespace reader for opaque image templates", () => {
    const app = new App();
    const chart = new Chart(app, "worker", { namespace: "worker" });
    const resource = new ApiObject(chart, "worker", {
      apiVersion: "v1",
      kind: "Pod",
      spec: { containers: [{ image: "{{ .Values.worker.image }}" }] },
    });
    prepareDockerHubPullSecrets(app);
    attachDockerHubPullSecrets(app);
    expect(secrets(app).map((secret) => secret.metadata.namespace)).toEqual([
      "worker",
    ]);
    expect(resource.toJson()).toHaveProperty("spec.imagePullSecrets", [
      { name: "dockerhub-pull-worker" },
    ]);
  });

  it("attaches the namespace reader to a private image's Helm fallback", () => {
    const app = new App();
    const chart = new Chart(app, "arcade", { namespace: "arcade" });
    const resource = new ApiObject(chart, "arcade", {
      apiVersion: "v1",
      kind: "Pod",
      spec: {
        containers: [
          {
            image:
              '{{ .Values.delivery.image | default "docker.io/shepherdjerred/arcade:current" }}',
          },
        ],
      },
    });
    prepareDockerHubPullSecrets(app);
    attachDockerHubPullSecrets(app);
    expect(secrets(app).map((secret) => secret.metadata.namespace)).toEqual([
      "arcade",
    ]);
    expect(resource.toJson()).toHaveProperty("spec.imagePullSecrets", [
      { name: "dockerhub-pull-arcade" },
    ]);
  });
});

describe("Docker Hub credential preparation", () => {
  it.each(["ngzmppq52zm7sii6ato2mv3sbi", "different-item"])(
    "reuses only the exact declared namespace reader (%s)",
    (itemId) => {
      const { app, chart } = fixtures();
      new OnePasswordItem(chart, "declared-reader", {
        metadata: {
          name: "dockerhub-pull-woodpecker",
          namespace: "woodpecker",
        },
        type: "kubernetes.io/dockerconfigjson",
        spec: { itemPath: vaultItemPath(itemId) },
      });
      if (itemId === "different-item") {
        expect(() => prepareDockerHubPullSecrets(app)).toThrow();
      } else {
        prepareDockerHubPullSecrets(app);
        prepareDockerHubPullSecrets(app);
        expect(
          secrets(app)
            .map((secret) => secret.metadata.namespace)
            .sort(),
        ).toEqual(["woodpecker", "woodpecker-ci"]);
      }
    },
  );
  it.each([
    "Pod",
    "Deployment",
    "StatefulSet",
    "DaemonSet",
    "ReplicaSet",
    "Job",
  ])(
    "attaches the reader to private init containers in %s and preserves existing secrets",
    (kind) => {
      const app = new App();
      const chart = new Chart(app, "private", { namespace: "private" });
      const pod = {
        containers: [{ image: "docker.io/library/alpine:latest" }],
        initContainers: [
          { image: "docker.io/shepherdjerred/velero-plugin:current" },
        ],
        imagePullSecrets: [{ name: "existing" }],
      };
      const resource = new ApiObject(chart, "workload", {
        apiVersion:
          kind === "Pod" ? "v1" : kind === "Job" ? "batch/v1" : "apps/v1",
        kind,
        spec: kind === "Pod" ? pod : { template: { spec: pod } },
      });
      attachDockerHubPullSecrets(app);
      attachDockerHubPullSecrets(app);
      const json = z.object({ spec: z.unknown() }).parse(resource.toJson());
      const renderedPod =
        kind === "Pod"
          ? json.spec
          : z
              .object({ template: z.object({ spec: z.unknown() }) })
              .parse(json.spec).template.spec;
      expect(
        z
          .object({ imagePullSecrets: z.array(z.object({ name: z.string() })) })
          .parse(renderedPod).imagePullSecrets,
      ).toEqual([{ name: "existing" }, { name: "dockerhub-pull-private" }]);
    },
  );

  it("does not attach credentials to upstream or public compiler pods", () => {
    const app = new App();
    const chart = new Chart(app, "public", { namespace: "public" });
    const resources = [
      "docker.io/library/alpine:latest",
      "docker.io/shepherdjerred/windows-cross-compiler:current",
    ].map(
      (image, index) =>
        new ApiObject(chart, `pod-${index.toString()}`, {
          apiVersion: "v1",
          kind: "Pod",
          spec: { containers: [{ image }] },
        }),
    );
    attachDockerHubPullSecrets(app);
    for (const resource of resources)
      expect(resource.toJson()).not.toHaveProperty("spec.imagePullSecrets");
  });
  it("prepares one typed, reader-only secret per consumer namespace and CI", () => {
    const { app, chart } = fixtures();
    new ApiObject(chart, "second-worker", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      spec: {
        template: {
          spec: {
            containers: [
              {
                image:
                  "docker.io/shepherdjerred/temporal-worker@sha256:" +
                  "1".repeat(64),
              },
            ],
          },
        },
      },
    });
    prepareDockerHubPullSecrets(app);
    expect(
      secrets(app)
        .map((resource) => resource.metadata.namespace)
        .sort(),
    ).toEqual(["woodpecker", "woodpecker-ci"]);
    for (const resource of secrets(app)) {
      expect(resource.type).toBe("kubernetes.io/dockerconfigjson");
      expect(resource.spec.itemPath).toMatch(
        /\/items\/ngzmppq52zm7sii6ato2mv3sbi$/u,
      );
      expect(resource).not.toHaveProperty("data");
      expect(resource).not.toHaveProperty("stringData");
    }
  });

  it("uses a Helm application's destination namespace for its image consumer", () => {
    const { app, chart } = fixtures();
    new ApiObject(chart, "velero", {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      spec: {
        destination: { namespace: "velero" },
        source: {
          helm: {
            valuesObject: {
              initContainers: [
                { image: "ghcr.io/shepherdjerred/velero-plugin:current" },
              ],
            },
          },
        },
      },
    });
    prepareDockerHubPullSecrets(app);
    expect(
      secrets(app)
        .map((resource) => resource.metadata.namespace)
        .sort(),
    ).toEqual(["velero", "woodpecker", "woodpecker-ci"]);
  });

  it("does not provision credentials for upstream, public, or inactive charts", () => {
    const { app } = fixtures();
    for (const [name, image] of [
      ["upstream", "docker.io/library/nginx:stable"],
      ["public", "docker.io/shepherdjerred/windows-cross-compiler:current"],
      ["other-owner", "ghcr.io/other/private:current"],
    ] as const) {
      const chart = new Chart(app, name, { namespace: name });
      new ApiObject(chart, "consumer", {
        apiVersion: "v1",
        kind: "Pod",
        spec: { containers: [{ image }] },
      });
    }
    const inactive = new Chart(app, "inactive", { namespace: "inactive" });
    new ApiObject(inactive, "activation", {
      apiVersion: "v1",
      kind: "ConfigMap",
      data: { active: "false" },
    });
    prepareDockerHubPullSecrets(app);
    expect(
      secrets(app)
        .map((resource) => resource.metadata.namespace)
        .sort(),
    ).toEqual(["woodpecker", "woodpecker-ci"]);
  });

  it("covers runtime pods whose images appear only in an admission allowlist", () => {
    const { app } = fixtures();
    const chart = new Chart(app, "mc-sandbox", { namespace: "mc-sandbox" });
    new ApiObject(chart, "pod-guard", {
      apiVersion: "admissionregistration.k8s.io/v1",
      kind: "ValidatingAdmissionPolicy",
      spec: {
        validations: [
          {
            expression: `object.spec.containers.all(c, c.image in ["ghcr.io/shepherdjerred/the-storm-server:current"])`,
          },
        ],
      },
    });
    prepareDockerHubPullSecrets(app);
    expect(
      secrets(app)
        .map((resource) => resource.metadata.namespace)
        .sort(),
    ).toEqual(["mc-sandbox", "woodpecker", "woodpecker-ci"]);
  });
});
