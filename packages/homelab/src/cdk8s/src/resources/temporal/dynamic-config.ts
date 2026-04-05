import type { Chart } from "cdk8s";
import { ConfigMap } from "cdk8s-plus-31";

export function createTemporalDynamicConfig(chart: Chart) {
  const configMap = new ConfigMap(chart, "temporal-dynamic-config", {
    metadata: {
      name: "temporal-dynamic-config",
    },
    data: {
      "dynamic-config.yaml": [
        "# Temporal dynamic configuration",
        "# Settings here can be changed without restarting the server.",
        "# The server polls this file periodically for updates.",
        "#",
        "# Example overrides:",
        "# frontend.rps:",
        "#   - value: 2400",
        "# matching.numTaskqueueReadPartitions:",
        "#   - value: 4",
      ].join("\n"),
    },
  });

  return configMap;
}
