import { ApiObject, type Chart } from "cdk8s";

export function applyForumSyncWaves(chart: Chart): void {
  for (const resource of chart.node.findAll()) {
    if (!ApiObject.isApiObject(resource)) continue;
    resource.metadata.addAnnotation(
      "argocd.argoproj.io/sync-wave",
      forumSyncWave(resource),
    );
  }
}

function forumSyncWave(resource: ApiObject): string {
  switch (resource.kind) {
    case "Namespace": {
      return "-4";
    }
    case "OnePasswordItem":
    case "Certificate": {
      return "-3";
    }
    case "PersistentVolumeClaim": {
      // zfs-ssd uses WaitForFirstConsumer. Applying a claim in an earlier
      // wave blocks the workload that the provisioner needs to bind it.
      if (resource.name.endsWith("-database")) return "-1";
      if (resource.name.endsWith("-files")) return "0";
      throw new Error(`Unknown forum storage claim: ${resource.name}`);
    }
    case "Deployment": {
      return resource.name === "storm-forum-database" ? "-1" : "1";
    }
    case "Job": {
      return "0";
    }
    default: {
      return "-2";
    }
  }
}
