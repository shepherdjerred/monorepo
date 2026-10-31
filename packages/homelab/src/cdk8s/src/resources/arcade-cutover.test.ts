import { App } from "cdk8s";
import { describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createArcadeChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/arcade.ts";

const Resource = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.record(z.string(), z.unknown()).optional(),
  data: z.record(z.string(), z.string()).optional(),
  subjects: z.array(z.object({ name: z.string() })).optional(),
});

function resources() {
  const app = new App();
  createArcadeChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    Resource.parse(document.toJSON()),
  );
}

describe("Arcade account handover", () => {
  test("runs exactly one command owner without the legacy game resources", () => {
    const manifests = resources();
    const deployments = manifests.filter(
      (resource) => resource.kind === "Deployment",
    );
    expect(
      deployments.map((resource) => resource.metadata.name).toSorted(),
    ).toEqual(["arcade", "arcade-edge"]);
    expect(
      deployments.find((resource) => resource.metadata.name === "arcade")?.spec,
    ).toMatchObject({ replicas: 1 });
    const config = manifests.find(
      (resource) => resource.metadata.name === "arcade-arcade-config",
    );
    expect(config?.data?.["arcade.toml"]).toContain("controllerActive = true");
    expect(
      manifests.some((resource) =>
        [
          "mario-kart-mario-kart-config",
          "pokemon-pokemon-config",
          "pokemon-seaweedfs-s3-credentials",
          "mario-kart-ui-service",
          "mario-kart-service-monitor",
        ].includes(resource.metadata.name),
      ),
    ).toBe(false);
    const arcade = manifests.find(
      (resource) =>
        resource.kind === "Deployment" && resource.metadata.name === "arcade",
    );
    expect(arcade?.spec).toMatchObject({
      template: {
        spec: {
          containers: expect.arrayContaining([
            expect.objectContaining({
              env: expect.arrayContaining([
                { name: "FLIPT_ENVIRONMENT", value: "prod" },
                { name: "DEPLOYMENT_ENVIRONMENT", value: "prod" },
                {
                  name: "WEB_PUBLIC_ORIGIN",
                  value: "https://arcade.sjer.red",
                },
              ]),
            }),
          ]),
        },
      },
    });
  });

  test("routes the canonical hostname through the edge without legacy aliases", () => {
    const manifests = resources();
    const edgeConfig = manifests.find(
      (resource) =>
        resource.kind === "ConfigMap" &&
        resource.metadata.name.endsWith("edge-config"),
    );
    expect(edgeConfig?.data?.["Caddyfile"]).toContain(
      "reverse_proxy arcade-arcade-ui.arcade.svc.cluster.local:8081",
    );
    const edge = manifests.filter(
      (resource) => resource.metadata.namespace === "arcade",
    );
    expect(edge.filter((resource) => resource.kind === "Ingress")).toEqual([]);
    expect(
      edge.some(
        (resource) => resource.metadata.name === "arcade-legacy-redirects",
      ),
    ).toBe(false);
    expect(edgeConfig?.data?.["Caddyfile"]).toContain(
      "https://arcade.sjer.red",
    );
    expect(edgeConfig?.data?.["Caddyfile"]).not.toContain("mariokart.sjer.red");
    expect(edgeConfig?.data?.["Caddyfile"]).not.toContain("pokebot.sjer.red");
  });
});
