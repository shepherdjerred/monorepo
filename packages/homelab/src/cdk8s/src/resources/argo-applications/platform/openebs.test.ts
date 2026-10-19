import { App, Chart } from "cdk8s";
import { expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createOpenEBSApp } from "./openebs.ts";
import { prepareDockerHubPullSecrets } from "@shepherdjerred/homelab/cdk8s/src/dockerhub-pull-secrets.ts";
import { bindChartImageDependencies } from "homelab/scripts/helm/helm-delivery-publication.ts";

const digest = `sha256:${"a".repeat(64)}`;
function synthesis() {
  const app = new App();
  createOpenEBSApp(new Chart(app, "apps"));
  prepareDockerHubPullSecrets(app);
  return app.synthYaml();
}

test("OpenEBS publication freezes its original driver digest and prepares the existing reader for both CSI roles", () => {
  const resources = parseAllDocuments(
    bindChartImageDependencies(synthesis(), {
      "shepherdjerred/zfs-driver": digest,
    }),
  ).map((document) =>
    z
      .object({
        kind: z.string(),
        metadata: z.object({ name: z.string() }).loose(),
      })
      .loose()
      .parse(document.toJSON()),
  );
  expect(
    resources.find((resource) => resource.kind === "Application"),
  ).toMatchObject({
    spec: {
      source: {
        chart: "openebs",
        targetRevision: "4.6.2",
        helm: {
          valuesObject: {
            "zfs-localpv": {
              imagePullSecrets: [{ name: "dockerhub-pull-openebs" }],
              zfsPlugin: {
                image: {
                  registry: "",
                  repository: "docker.io/shepherdjerred/zfs-driver",
                  tag: `selected@${digest}`,
                },
              },
            },
          },
        },
      },
    },
  });
  expect(
    resources.filter((resource) => resource.kind === "OnePasswordItem"),
  ).toEqual([
    expect.objectContaining({
      metadata: expect.objectContaining({
        name: "dockerhub-pull-openebs",
        namespace: "openebs",
      }),
      type: "kubernetes.io/dockerconfigjson",
      spec: {
        itemPath:
          "vaults/v64ocnykdqju4ui6j6pua56xw4/items/ngzmppq52zm7sii6ato2mv3sbi",
      },
    }),
  ]);
  expect(
    bindChartImageDependencies(synthesis(), {
      "shepherdjerred/zfs-driver": digest,
    }),
  ).not.toContain("Delivery requires image:zfs-driver");
});

test("the first driver chart cannot publish without its fresh original image digest", () => {
  expect(() => bindChartImageDependencies(synthesis(), {})).toThrow(
    "Root chart dependency lacks its original published image:zfs-driver",
  );
});
