import { App, Chart } from "cdk8s";
import { createPokemonDeployment } from "../resources/pokemon.ts";

export function createPokemonChart(app: App) {
  const chart = new Chart(app, "pokemon", {
    namespace: "pokemon",
    disableResourceNameHashes: true,
  });

  createPokemonDeployment(chart);
}
