import { Chart, type App } from "cdk8s";
import { z } from "zod";
import { KubeConfigMap } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import inventory from "./releases.json";
import { createStormForumChart, ReleaseSchema } from "./index.ts";

const InventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    releases: z.array(ReleaseSchema).max(2),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.releases.map((release) => release.stage)).size ===
      value.releases.length,
    "Each stage has one explicit release",
  );
export const forumReleases = InventorySchema.parse(inventory).releases;
export function createStormForumCharts(app: App): void {
  for (const stage of ["beta", "prod"] as const) {
    const name = stage === "beta" ? "storm-forum-beta" : "storm-forum";
    const release = forumReleases.find(
      (candidate) => candidate.stage === stage,
    );
    if (release) {
      createStormForumChart(app, release);
    } else {
      // Publish a valid inactive chart without provisioning a forum or inventing pins.
      const chart = new Chart(app, name, {
        namespace: name,
        disableResourceNameHashes: true,
      });
      new KubeConfigMap(chart, "activation", { data: { active: "false" } });
    }
  }
}
export function createStormForumApplications(chart: Chart): void {
  for (const release of forumReleases) {
    const name = release.stage === "beta" ? "storm-forum-beta" : "storm-forum";
    new Application(chart, `${name}-app`, {
      metadata: { name },
      spec: {
        project: "default",
        revisionHistoryLimit: 5,
        source: {
          repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
          chart: name,
          targetRevision: "~2.0.0-0",
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: name,
        },
        syncPolicy: {
          automated: { enabled: false },
          syncOptions: ["CreateNamespace=true"],
        },
      },
    });
  }
}
