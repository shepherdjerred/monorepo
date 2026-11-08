import { describe, expect, test } from "vitest";
import {
  DeploymentDetailSchema,
  workerHostSpecification,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { temporal, CANDIDATE, STABLE } from "./model-worker-fixture.ts";
import {
  workerAcceptanceMode,
  workerRoutingInput,
} from "./worker-acceptance.ts";
import {
  prepareDeliveryWorkerRollout,
  stepDeliveryWorkerRollout,
} from "./worker-rollout.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";
import { workerProofCommand } from "./worker-pool-fixture.ts";

const json = (value: unknown) => ({
  stdout: JSON.stringify(value),
  stderr: "",
});

function selections() {
  const base = temporal([]);
  const pool = base.deployment.workerSnapshot;
  const image = base.versionSet.components["image:temporal-worker"];
  if (pool === null || image === undefined)
    throw new Error("Fixture lacks a worker image");
  const repository = "docker.io/shepherdjerred/scout-for-lol";
  const restored = DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      id: "accepted/prod",
      environmentId: "scout-for-lol/prod",
      serviceId: "scout-for-lol",
      kind: "promote",
      status: "succeeded",
      finishedAt: base.deployment.createdAt,
      workerSnapshot: {
        ...pool,
        environmentId: "scout-for-lol/prod",
        target: "scout-prod",
        versions: pool.versions.map((worker) => ({
          ...worker,
          environmentId: "scout-for-lol/prod",
          image: `${repository}@${worker.digest}`,
          host: workerHostSpecification("scout-prod"),
        })),
      },
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "scout-for-lol",
      components: {
        "image:temporal-worker": { ...image, uri: repository },
      },
    },
    pipeline: {
      ...base.pipeline,
      definition: {
        kind: "argocd",
        application: "scout-prod",
        chartRepository: "https://chartmuseum.sjer.red",
        chartName: "scout-for-lol",
        chartComponent: "chart",
        parameters: {},
        workerRollout: {
          target: "scout-prod",
          imageComponent: "image:temporal-worker",
          runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"c".repeat(64)}`,
        },
      },
    },
  });
  const detail = DeploymentDetailSchema.parse({
    ...restored,
    deployment: {
      ...restored.deployment,
      id: "rollback/prod",
      kind: "rollback",
      restoredDeploymentId: restored.deployment.id,
      status: "running",
      finishedAt: null,
    },
  });
  return { detail, restored };
}

describe("accepted worker restoration", () => {
  test("requires the exact accepted deployment, selection, image and retained host", () => {
    const { detail, restored } = selections();
    expect(workerRoutingInput(detail, restored).restored?.deployment.id).toBe(
      "accepted/prod",
    );
    expect(() => workerRoutingInput(detail, null)).toThrow(
      /previously accepted/u,
    );
    for (const change of [
      (record: DeploymentDetail) => {
        record.deployment.id = "other";
      },
      (record: DeploymentDetail) => {
        record.deployment.status = "failed";
      },
      (record: DeploymentDetail) => {
        record.deployment.finishedAt = null;
      },
      (record: DeploymentDetail) => {
        record.deployment.kind = "adopt-worker";
      },
      (record: DeploymentDetail) => {
        record.deployment.environmentId = "scout-for-lol/beta";
      },
      (record: DeploymentDetail) => {
        record.deployment.serviceId = "other";
      },
      (record: DeploymentDetail) => {
        record.deployment.versionSetRevisionId = "other";
      },
      (record: DeploymentDetail) => {
        record.deployment.pipelineRevisionId = "other";
      },
      (record: DeploymentDetail) => {
        record.deployment.configurationId = "other";
      },
      (record: DeploymentDetail) => {
        record.versionSet.id = "other";
      },
      (record: DeploymentDetail) => {
        record.pipeline.id = "other";
      },
      (record: DeploymentDetail) => {
        const image = record.versionSet.components["image:temporal-worker"];
        if (image) image.digest = `sha256:${"f".repeat(64)}`;
      },
      (record: DeploymentDetail) => {
        if (record.deployment.workerSnapshot)
          record.deployment.workerSnapshot.candidateBuildId = STABLE;
      },
      (record: DeploymentDetail) => {
        if (record.deployment.workerSnapshot)
          record.deployment.workerSnapshot.versions = [];
      },
    ]) {
      const invalid = structuredClone(restored);
      change(invalid);
      expect(() => workerRoutingInput(detail, invalid)).toThrow();
    }
    const promotion = structuredClone(detail);
    promotion.deployment.kind = "promote";
    expect(() => workerRoutingInput(promotion, restored)).toThrow(
      /Only a rollback/u,
    );
    promotion.deployment.restoredDeploymentId = null;
    expect(workerAcceptanceMode(promotion, null)).toBe("prerequisite");
  });

  test("restores after beta advances while preserving image, replay, poller and canary checks", async () => {
    const { detail, restored } = selections();
    const input = workerRoutingInput(detail, restored);
    const commands: string[][] = [];
    let current = STABLE;
    const run: RolloutCommandRunner = async (argv) => {
      const command = [...argv];
      commands.push(command);
      const proof = workerProofCommand(command, CANDIDATE);
      if (proof !== undefined) return proof;
      if (command[0] === "bun")
        return { stdout: "candidate proof passed", stderr: "" };
      if (command[1] === "prom")
        return json({
          status: "success",
          data: {
            resultType: "vector",
            result: [{ value: [1_788_000_000, "1"] }],
          },
        });
      if (command.includes("describe-version"))
        return json({
          BuildID: CANDIDATE,
          taskQueuesInfos: [{ name: "scout-prod", type: "workflow" }],
        });
      if (command.includes("describe")) {
        const name = command[command.indexOf("--name") + 1];
        return json({
          name,
          versionSummaries: [],
          routingConfig: {
            currentVersionBuildID:
              name === "scout-beta-workflows" ? "c".repeat(40) : current,
            rampingVersionBuildID: "",
            rampingVersionPercentage: 0,
            currentVersionChangedTime: "2026-11-08T05:00:00.000Z",
            rampingVersionChangedTime: "2026-11-08T05:00:00.000Z",
            rampingVersionPercentageChangedTime: "2026-11-08T05:00:00.000Z",
          },
        });
      }
      if (command.includes("set-current-version")) {
        current = CANDIDATE;
        return json({});
      }
      throw new Error(`Unexpected proof command: ${command.join(" ")}`);
    };
    const connection = { address: "temporal.test:7233" };
    const plan = await prepareDeliveryWorkerRollout(
      input.detail,
      connection,
      run,
      { candidate: run, restored: input.restored },
    );
    await stepDeliveryWorkerRollout(
      { ...input, plan, connection, action: "promote" },
      run,
    );
    await stepDeliveryWorkerRollout(
      { ...input, plan, connection, action: "verify" },
      run,
    );
    expect(current).toBe(CANDIDATE);
    expect(
      commands.some((command) => command.includes("scout-beta-workflows")),
    ).toBe(false);
    expect(commands.some((command) => command.includes("test:workflows"))).toBe(
      true,
    );
    expect(
      commands.some((command) =>
        command.includes("replay:candidate-histories"),
      ),
    ).toBe(true);
    expect(commands.filter((command) => command[0] === "docker")).toHaveLength(
      2,
    );
    expect(
      commands.filter(
        (command) =>
          command.includes("scripts/run-canary.ts") ||
          command.some((part) => part.endsWith("/scripts/run-canary.ts")),
      ),
    ).toHaveLength(3);
    expect(commands.some((command) => command[1] === "prom")).toBe(true);
    const promotion = structuredClone(input.detail);
    promotion.deployment.kind = "promote";
    promotion.deployment.restoredDeploymentId = null;
    await expect(
      prepareDeliveryWorkerRollout(promotion, connection, run),
    ).rejects.toThrow(/scout-beta-workflows acceptance/u);
    expect(
      commands.some((command) => command.includes("scout-beta-workflows")),
    ).toBe(true);
  });
});
