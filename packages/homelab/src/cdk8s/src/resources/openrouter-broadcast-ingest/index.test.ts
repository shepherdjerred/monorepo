import { expect, test } from "bun:test";
import { App, Chart, Testing } from "cdk8s";
import { createOpenRouterBroadcastIngestDeployment } from "./index.ts";

test("synthesizes authenticated archive, Tempo, monitoring, and ingress wiring", () => {
  const app = new App();
  const chart = new Chart(app, "test", {
    namespace: "openrouter-broadcast-ingest",
    disableResourceNameHashes: true,
  });
  createOpenRouterBroadcastIngestDeployment(chart);
  const manifests = JSON.stringify(Testing.synth(chart));

  expect(manifests).toContain("OPENROUTER_BROADCAST_BEARER_TOKEN");
  expect(manifests).toContain("SEAWEEDFS_ACCESS_KEY_ID");
  expect(manifests).toContain("seaweedfs-s3.seaweedfs.svc.cluster.local:8333");
  expect(manifests).toContain("tempo.tempo.svc.cluster.local:4318/v1/traces");
  expect(manifests).toContain("openrouter-broadcast.sjer.red");
  expect(manifests).toContain("ServiceMonitor");
  expect(manifests).toContain('"readOnlyRootFilesystem":true');
});
