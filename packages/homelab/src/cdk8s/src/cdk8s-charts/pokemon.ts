import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createPokemonDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/pokemon.ts";

export function createPokemonChart(app: App) {
  const chart = new Chart(app, "pokemon", {
    namespace: "pokemon",
    disableResourceNameHashes: true,
  });

  createPokemonDeployment(chart);
}
