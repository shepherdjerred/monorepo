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
  subjects: z.array(z.object({ name: z.string() })).optional(),
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

  test("keeps both Pokébot aliases on a redirect without legacy account credentials", () => {
    const manifests = resources();
    const redirect = manifests.find(
      (resource) =>
        resource.kind === "Deployment" &&
        resource.metadata.name === "pokemon-web-redirect",
    );
    expect(redirect?.spec).toMatchObject({ replicas: 1 });
    expect(JSON.stringify(redirect)).not.toContain("secretKeyRef");
    const selector = z
      .object({ matchLabels: z.record(z.string(), z.string()) })
      .parse(redirect?.spec?.["selector"]);
    const service = manifests.find(
      (resource) =>
        resource.kind === "Service" &&
        resource.metadata.name === "pokemon-ui-service",
    );
    expect(service?.spec?.["selector"]).toEqual(selector.matchLabels);
    expect(
      manifests.find(
        (resource) =>
          resource.kind === "Ingress" &&
          resource.metadata.namespace === "pokemon",
      )?.spec,
    ).toMatchObject({
      defaultBackend: {
        service: { name: service?.metadata.name, port: { number: 8081 } },
      },
    });
    expect(
      manifests.find(
        (resource) =>
          resource.kind === "TunnelBinding" &&
          resource.metadata.namespace === "pokemon",
      )?.subjects,
    ).toEqual([expect.objectContaining({ name: service?.metadata.name })]);
    expect(
      manifests.find(
        (resource) =>
          resource.kind === "ConfigMap" &&
          resource.metadata.name === "pokemon-web-redirect-config",
      )?.data?.["Caddyfile"],
    ).toContain("redir https://mariokart.sjer.red 308");
  });
});
