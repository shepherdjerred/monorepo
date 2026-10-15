import { App } from "cdk8s";
import { describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createArcadeChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/arcade.ts";
import { createMarioKartChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/mario-kart.ts";
import { createPokemonChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/pokemon.ts";

const Resource = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.record(z.string(), z.unknown()).optional(),
  data: z.record(z.string(), z.string()).optional(),
});

function resources() {
  const app = new App();
  createArcadeChart(app);
  createMarioKartChart(app);
  createPokemonChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    Resource.parse(document.toJSON()),
  );
}

describe("Arcade account handover", () => {
  test("runs exactly one command owner while retaining the original save claims", () => {
    const manifests = resources();
    for (const [name, replicas] of [
      ["arcade", 1],
      ["mario-kart", 0],
      ["pokemon", 0],
    ] as const) {
      expect(
        manifests.find(
          (resource) =>
            resource.kind === "Deployment" && resource.metadata.name === name,
        )?.spec,
      ).toMatchObject({ replicas });
    }
    for (const name of [
      "mario-kart-volume",
      "mario-kart-data-volume",
      "pokemon-volume",
    ]) {
      expect(
        manifests.some(
          (resource) =>
            resource.kind === "PersistentVolumeClaim" &&
            resource.metadata.name === name,
        ),
      ).toBe(true);
    }
    const config = manifests.find(
      (resource) => resource.metadata.name === "arcade-arcade-config",
    );
    expect(config?.data?.["arcade.toml"]).toContain("controllerActive = true");
  });

  test("routes both public and tailnet traffic through the edge to Arcade", () => {
    const manifests = resources();
    const edgeConfig = manifests.find(
      (resource) =>
        resource.kind === "ConfigMap" &&
        resource.metadata.name.endsWith("edge-config"),
    );
    expect(edgeConfig?.data?.["Caddyfile"]).toContain(
      "reverse_proxy arcade-arcade-ui.arcade.svc.cluster.local:8081",
    );
    const ingress = manifests.find(
      (resource) =>
        resource.kind === "Ingress" &&
        resource.metadata.namespace === "mario-kart",
    );
    expect(ingress?.spec).toMatchObject({
      defaultBackend: {
        service: {
          name: "mario-kart-mario-kart-edge-bootstrap",
          port: { number: 8082 },
        },
      },
    });
  });
});
