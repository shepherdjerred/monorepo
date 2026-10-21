import type { Chart } from "cdk8s";
import {
  AppProject,
  type AppProjectSpec,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import {
  ARGOCD_PROJECTS,
  IN_CLUSTER_SERVER,
  childSourceRepositories,
  renderedClusterResources,
  rootSourceRepositories,
} from "./projects.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";

const inCluster: AppProjectSpec["destinations"] = [
  { server: IN_CLUSTER_SERVER, namespace: "*" },
];

/** The single permissive project every Application uses before the window. */
function createLegacyProject(chart: Chart) {
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

/**
 * Under transition rendering, three AppProjects, rendered by the root chart ahead of every Application
 * (see `APPLICATION_SYNC_WAVES.appProject`). `default` keeps exactly what the
 * root app-of-apps needs: repository charts and the cluster-scoped kinds this
 * chart itself renders. Children are split by whether their chart may create
 * cluster-scoped resources; a `workloads` chart owns only its Namespace.
 */
export function createProject(
  chart: Chart,
  transition: boolean = transitionRendering(),
) {
  if (!transition) {
    createLegacyProject(chart);
    return;
  }
  new AppProject(chart, "project", {
    metadata: { name: ARGOCD_PROJECTS.root },
    spec: {
      description: "Root app-of-apps only",
      sourceRepos: rootSourceRepositories(),
      destinations: inCluster,
      clusterResourceWhitelist: renderedClusterResources(chart),
    },
  });
  new AppProject(chart, "cluster-project", {
    metadata: { name: ARGOCD_PROJECTS.cluster },
    spec: {
      description:
        "Operators, CRD providers and self-hosted platform services that create cluster-scoped resources",
      sourceRepos: childSourceRepositories(),
      destinations: inCluster,
      clusterResourceWhitelist: [{ group: "*", kind: "*" }],
    },
  });
  new AppProject(chart, "workloads-project", {
    metadata: { name: ARGOCD_PROJECTS.workloads },
    spec: {
      description: "Namespaced workloads that own only their Namespace",
      sourceRepos: childSourceRepositories(),
      destinations: inCluster,
      clusterResourceWhitelist: [{ group: "", kind: "Namespace" }],
    },
  });
}
