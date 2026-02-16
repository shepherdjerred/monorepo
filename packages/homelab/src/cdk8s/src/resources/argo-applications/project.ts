import { Chart } from "cdk8s";
import { AppProject } from "../../../generated/imports/argoproj.io.ts";

export function createProject(chart: Chart) {
  new AppProject(chart, "project", {
    metadata: {
      name: "default",
    },
    spec: {
      sourceRepos: ["*"],
      destinations: [
        {
          namespace: "*",
          server: "*",
        },
      ],
      clusterResourceWhitelist: [
        {
          group: "*",
          kind: "*",
        },
      ],
    },
  });
}
