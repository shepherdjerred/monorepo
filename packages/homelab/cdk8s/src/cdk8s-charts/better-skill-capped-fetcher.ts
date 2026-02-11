import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createBetterSkillCappedFetcher } from "../resources/better-skill-capped-fetcher.ts";

export function createBetterSkillCappedFetcherChart(app: App) {
  const chart = new Chart(app, "better-skill-capped-fetcher", {
    namespace: "better-skill-capped",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "better-skill-capped-namespace", {
    metadata: {
      name: "better-skill-capped",
    },
  });

  createBetterSkillCappedFetcher(chart);
}
