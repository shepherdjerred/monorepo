import { App, Chart } from "cdk8s";
import { describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createArcadeChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/arcade.ts";
import { createMarioKartChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/mario-kart.ts";
import { createPokemonChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/pokemon.ts";
import { createArcadeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/arcade.ts";
import { createMarioKartApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/mario-kart.ts";
import { createPokemonApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/pokemon.ts";
import { applyApplicationReleasePolicy } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";

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
  createMarioKartChart(app);
  createPokemonChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    Resource.parse(document.toJSON()),
  );
}

describe("Arcade account handover", () => {
  test("reconciles the shared owner after both legacy applications", () => {
    const app = new App();
    const root = new Chart(app, "apps", { namespace: "argocd" });
    createArcadeApp(root);
    createMarioKartApp(root);
    createPokemonApp(root);
    // The central policy overwrites annotations declared by individual factories.
    applyApplicationReleasePolicy(app);
    const applications = parseAllDocuments(app.synthYaml()).map((document) =>
      Resource.parse(document.toJSON()),
    );
    const wave = (name: string) => {
      const application = applications.find(
        (resource) => resource.metadata.name === name,
      );
      if (application === undefined) throw new Error(`Missing ${name}`);
      // Argo's declared default is wave zero when the annotation is absent.
      const value =
        application.metadata.annotations?.["argocd.argoproj.io/sync-wave"] ??
        "0";
      if (!/^-?\d+$/u.test(value)) throw new Error(`Invalid wave for ${name}`);
      return Number(value);
    };
    expect(wave("arcade")).toBeGreaterThan(wave("mario-kart"));
    expect(wave("arcade")).toBeGreaterThan(wave("pokemon"));
  });
  test("runs exactly one command owner while retaining the original save claims", () => {
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
    for (const name of [
      "mario-kart-volume",
      "mario-kart-data-volume",
      "mario-kart-rom-volume",
      "mario-kart-edge-data",
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

  test("legacy charts retain only their original recovery claims", () => {
    const manifests = resources();
    for (const [namespace, names] of [
      [
        "mario-kart",
        [
          "mario-kart-volume",
          "mario-kart-data-volume",
          "mario-kart-rom-volume",
          "mario-kart-edge-data",
        ],
      ],
      ["pokemon", ["pokemon-volume"]],
    ] as const) {
      const retained = manifests.filter(
        (resource) => resource.metadata.namespace === namespace,
      );
      expect(
        retained.every((resource) => resource.kind === "PersistentVolumeClaim"),
      ).toBe(true);
      expect(
        retained.map((resource) => resource.metadata.name).toSorted(),
      ).toEqual([...names].toSorted());
    }
    expect(
      manifests.filter((resource) => resource.kind === "PersistentVolumeClaim"),
    ).toHaveLength(10);
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
        resource.metadata.namespace === "arcade" &&
        resource.metadata.name.includes("mariokart"),
    );
    expect(ingress?.spec).toMatchObject({
      defaultBackend: {
        service: {
          name: "arcade-edge-bootstrap",
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
        resource.metadata.name === "arcade-edge",
    );
    expect(redirect?.spec).toMatchObject({ replicas: 1 });
    expect(JSON.stringify(redirect)).not.toContain("secretKeyRef");
    const selector = z
      .object({ matchLabels: z.record(z.string(), z.string()) })
      .parse(redirect?.spec?.["selector"]);
    const service = manifests.find(
      (resource) =>
        resource.kind === "Service" &&
        resource.metadata.name === "arcade-legacy-redirects",
    );
    expect(service?.spec?.["selector"]).toEqual(selector.matchLabels);
    expect(
      manifests.find(
        (resource) =>
          resource.kind === "Ingress" &&
          resource.metadata.namespace === "arcade" &&
          resource.metadata.name.includes("pokebot"),
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
          resource.metadata.namespace === "arcade" &&
          resource.metadata.name.includes("pokebot"),
      )?.subjects,
    ).toEqual([expect.objectContaining({ name: service?.metadata.name })]);
    expect(
      manifests.find(
        (resource) =>
          resource.kind === "ConfigMap" &&
          resource.metadata.name === "arcade-edge-config",
      )?.data?.["Caddyfile"],
    ).toContain("redir https://arcade.sjer.red 307");
  });
});
