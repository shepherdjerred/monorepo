import { App, Chart } from "cdk8s";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAllDocuments, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { createTemporalWorkflowWorkers } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/workflow-worker.ts";
import { createScoutWorkflowWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/workflow-worker.ts";
import { workerPoolTemplate } from "./worker-pool-template.ts";
import {
  discoverChartInputs,
  fingerprintChart,
} from "homelab/scripts/helm/helm-release-core.ts";
import { stageChart } from "homelab/scripts/helm/helm-push.ts";

const FIRST = "a".repeat(40);
const SECOND = "b".repeat(40);
const THIRD = "c".repeat(40);
function pool(target: string, repository: string) {
  const profile =
    target === "central" ? "central-workflows" : `${target}-workflows`;
  return {
    schema: "delivery-worker-pool/v1",
    environmentId: "worker/prod",
    target,
    candidateBuildId: THIRD,
    versions: [FIRST, SECOND, THIRD].map((buildId, index) => ({
      environmentId: "worker/prod",
      buildId,
      host: { profile },
      image: `docker.io/shepherdjerred/${repository}@sha256:${buildId.slice(0, 1).repeat(64)}`,
      replicas: index === 0 ? 0 : 1,
    })),
  };
}
async function render(chartName: string, manifest: string, selected: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), "worker-host-render-"));
  try {
    await Bun.write(
      path.join(directory, "Chart.yaml"),
      `apiVersion: v2\nname: ${chartName}\nversion: 0.0.0\n`,
    );
    await Bun.write(
      path.join(directory, "values.yaml"),
      stringify({
        delivery: {
          workerPool: selected === "" ? "" : JSON.stringify(selected),
        },
      }),
    );
    await Bun.write(
      path.join(directory, "templates/hosts.yaml"),
      workerPoolTemplate(manifest, chartName),
    );
    const command = Bun.spawnSync([
      "helm",
      "template",
      "worker-test",
      directory,
    ]);
    if (command.exitCode !== 0) throw new Error(command.stderr.toString());
    return parseAllDocuments(command.stdout.toString())
      .map((document) => {
        if (document.errors.length > 0)
          throw new Error("Invalid Helm-rendered worker YAML");
        return document.toJSON() as unknown;
      })
      .filter((document) => document !== null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function synth(chartName: string, stage?: "beta" | "prod") {
  const app = new App();
  const chart = new Chart(app, chartName, {
    namespace: chartName,
    disableResourceNameHashes: true,
  });
  if (stage === undefined)
    createTemporalWorkflowWorkers(chart, {
      serverServiceName: "temporal-server",
    });
  else createScoutWorkflowWorker(chart, stage);
  return {
    manifest: chart
      .toJson()
      .map((resource) => stringify(resource))
      .join("---\n"),
    resources: chart.toJson(),
  };
}

describe("Delivery fixed worker host rendering", () => {
  it("keeps native synth valid while chart staging and published fingerprints use the real Helm template", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "native-worker-chart-"),
    );
    try {
      const source = synth("temporal");
      const native = path.join(directory, "dist/temporal.k8s.yaml");
      await Bun.write(native, source.manifest);
      await cp(
        new URL("../../helm/temporal", import.meta.url).pathname,
        path.join(directory, "helm/temporal"),
        { recursive: true },
      );
      const [input] = await discoverChartInputs(
        path.join(directory, "helm"),
        path.join(directory, "dist"),
      );
      if (input === undefined)
        throw new Error("Native chart is absent from publication inventory");
      const stage = path.join(directory, "staged");
      await stageChart(input, "2.0.0-42", stage);
      expect(await Bun.file(native).text()).toBe(source.manifest);
      expect(
        parseAllDocuments(await Bun.file(native).text()).every(
          (doc) => doc.errors.length === 0,
        ),
      ).toBe(true);
      const stagedTemplate = path.join(
        stage,
        "temporal/templates/temporal.k8s.yaml",
      );
      expect(await Bun.file(stagedTemplate).text()).toContain(
        "replicas: {{ $worker.replicas }}",
      );
      expect(
        await fingerprintChart(path.join(stage, "temporal"), stagedTemplate),
      ).toBe(input.fingerprint);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each(["temporal", "scout-beta", "scout-prod"])(
    "refuses %s without a frozen pool",
    async (name) => {
      const stage =
        name === "temporal"
          ? undefined
          : name === "scout-beta"
            ? "beta"
            : "prod";
      const source = synth(name, stage);
      await expect(render(name, source.manifest, "")).rejects.toThrow(
        "Delivery requires workerPool",
      );
    },
  );
  it.each(["temporal", "scout-beta", "scout-prod"])(
    "renders immutable retained hosts and zero replicas before pruning for %s",
    async (name) => {
      const central = name === "temporal";
      const repository = central ? "temporal-worker" : "scout-for-lol";
      const stage = central
        ? undefined
        : name === "scout-beta"
          ? "beta"
          : "prod";
      const source = synth(name, stage);
      const selected = pool(central ? "central" : name, repository);
      const resources = await render(name, source.manifest, selected);
      const encoded = JSON.stringify(resources);
      const deployments = resources.filter(
        (resource) =>
          JSON.stringify(resource).includes('"kind":"Deployment"') &&
          JSON.stringify(resource).includes("delivery-wf-"),
      );
      expect(deployments).toHaveLength(3);
      for (const [index, buildId] of [FIRST, SECOND, THIRD].entries()) {
        expect(deployments[index]).toMatchObject({
          metadata: {
            name: expect.stringContaining(`retained-${buildId.slice(0, 12)}`),
          },
          spec: {
            replicas: index === 0 ? 0 : 1,
            template: {
              spec: {
                automountServiceAccountToken: false,
                containers: [
                  {
                    image: `docker.io/shepherdjerred/${repository}@sha256:${buildId.slice(0, 1).repeat(64)}`,
                  },
                ],
              },
            },
          },
        });
      }
      expect(encoded).not.toContain("secretKeyRef");
      const oldDeployments = resources.filter(
        (resource) =>
          JSON.stringify(resource).includes('"kind":"Deployment"') &&
          !JSON.stringify(resource).includes("delivery-wf-"),
      );
      expect(oldDeployments).toHaveLength(0);
      expect(
        new Set(resources.map((resource) => JSON.stringify(resource))).size,
      ).toBe(resources.length);
    },
  );
  it("rejects malformed hosts and colliding build prefixes", async () => {
    const source = synth("temporal");
    const selected = pool("central", "temporal-worker");
    const second = selected.versions[1];
    if (second === undefined) throw new Error("Missing fixture host");
    second.buildId = `${FIRST.slice(0, 12)}${"d".repeat(28)}`;
    await expect(render("temporal", source.manifest, selected)).rejects.toThrow(
      "collision",
    );
    second.buildId = SECOND;
    second.image = "docker.io/arbitrary/privileged@sha256:" + "d".repeat(64);
    await expect(render("temporal", source.manifest, selected)).rejects.toThrow(
      "input invalid",
    );
  });
});
