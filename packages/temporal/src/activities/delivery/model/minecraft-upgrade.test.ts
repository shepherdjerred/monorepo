import { describe, expect, test } from "vitest";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { RecipeDefinitionSchema } from "@shepherdjerred/delivery/model-contract";
import { renderApplication } from "#lib/delivery/model/application.ts";
import {
  artifact,
  detail as arcadeDetail,
} from "#lib/delivery/model/testing.ts";
import {
  minecraftSyncFence,
  runMinecraftUpgradeStep,
  type MinecraftUpgradeEffects,
} from "./minecraft-upgrade.ts";

const KEY = "sub2-step-minecraft-upgrade";
const chart = artifact({
  id: "chart/minecraft",
  component: "chart:minecraft",
  kind: "chart",
  uri: "https://chartmuseum.sjer.red/charts/minecraft-5.0.0.tgz",
  version: "5.0.0",
  character: "c",
});
const server = artifact({
  id: "image/storm",
  component: "image:the-storm-server",
  kind: "image",
  uri: "docker.io/shepherdjerred/the-storm-server",
  version: "1.2.3",
  character: "d",
});

function application(name: string, chartName: string) {
  return {
    name,
    project: "default",
    destination: {
      server: "https://kubernetes.default.svc",
      namespace: "minecraft-tsmc",
    },
    source: { repoURL: "https://chartmuseum.sjer.red", chart: chartName },
    lifecycle: "retain",
  };
}

/** TSMC as the catalog declares it: a companion, then the upgraded server. */
function tsmc(releaseMode: "verified-restore" | "retained-volume-restart") {
  const upgrade = {
    kind: "minecraft-upgrade",
    instance: "application:minecraft-tsmc",
    pointOfNoReturn: true,
    imageComponent: "image:the-storm-server",
    releaseMode,
  };
  const instance = { instance: "application:minecraft-tsmc" };
  return {
    kind: "compound",
    subRecipes: [
      {
        instance: "application:minecraft-tsmc-companion",
        definition: {
          kind: "kubernetes-application",
          application: application("minecraft-tsmc-companion", "minecraft"),
          chartComponent: "chart:minecraft",
          runner: { service: "ci", component: "image:ci-base" },
          steps: [
            {
              kind: "apply-safety",
              instance: "application:minecraft-tsmc-companion",
            },
            { kind: "sync", instance: "application:minecraft-tsmc-companion" },
          ],
          oracle: { probes: [], tests: [] },
        },
      },
      {
        instance: "application:minecraft-tsmc",
        definition: {
          kind: "kubernetes-application",
          application: application("minecraft-tsmc", "minecraft"),
          chartComponent: "chart:minecraft",
          artifactParameters: {
            "image.tag": {
              component: "image:the-storm-server",
              format: "tag-digest",
            },
          },
          runner: { service: "ci", component: "image:ci-base" },
          steps: [
            { kind: "apply-safety", ...instance },
            { kind: "sync", ...instance },
            upgrade,
          ],
          oracle: { probes: [], tests: [] },
        },
      },
    ],
  };
}

function current(
  releaseMode: "verified-restore" | "retained-volume-restart",
  kind: "deploy" | "rollback" = "deploy",
): DeploymentDetail {
  const base = arcadeDetail(tsmc(releaseMode), chart, []);
  return DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      environmentId: "minecraft/tsmc",
      serviceId: "minecraft",
      kind,
    },
    environment: {
      ...base.environment,
      id: "minecraft/tsmc",
      serviceId: "minecraft",
      application: "minecraft-tsmc-companion",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "minecraft",
      components: {
        "chart:minecraft": chart,
        "image:the-storm-server": server,
      },
    },
    configuration: { id: "config/1", content: {} },
  });
}

function effects() {
  const calls: string[] = [];
  const recorded: MinecraftUpgradeEffects = {
    record: async (_current, key, status) => {
      calls.push(`record ${key} ${status}`);
    },
    pods: async (name) => {
      calls.push(`pods ${name}`);
      return [];
    },
    verifyPods: async (_pods, artifacts, references) => {
      calls.push(
        `verify ${artifacts.map((entry) => references.get(entry.id) ?? "").join(",")}`,
      );
    },
  };
  return { calls, effects: recorded };
}

const IMAGE = `docker.io/shepherdjerred/the-storm-server:1.2.3@sha256:${"d".repeat(64)}`;

describe("minecraft-upgrade step", () => {
  test("a retained-volume restart reads back the exact server image after the sync", async () => {
    const run = effects();
    expect(
      await runMinecraftUpgradeStep(
        current("retained-volume-restart"),
        KEY,
        run.effects,
      ),
    ).toEqual({ waiting: false });
    expect(run.calls).toEqual([
      `record ${KEY} running`,
      "pods minecraft-tsmc",
      `verify ${IMAGE}`,
      `record ${KEY} succeeded`,
    ]);
  });

  test("a historical verified-restore reads back the retained volume", async () => {
    const run = effects();
    expect(
      await runMinecraftUpgradeStep(
        current("verified-restore"),
        KEY,
        run.effects,
      ),
    ).toEqual({ waiting: false });
    expect(run.calls).toEqual([
      `record ${KEY} running`,
      "pods minecraft-tsmc",
      `verify ${IMAGE}`,
      `record ${KEY} succeeded`,
    ]);
  });

  test("a rollback reads back the retained volume", async () => {
    const run = effects();
    expect(
      await runMinecraftUpgradeStep(
        current("retained-volume-restart", "rollback"),
        KEY,
        run.effects,
      ),
    ).toEqual({ waiting: false });
    expect(run.calls).toEqual([
      `record ${KEY} running`,
      "pods minecraft-tsmc",
      `verify ${IMAGE}`,
      `record ${KEY} succeeded`,
    ]);
  });
});

describe("TSMC rendering and the sync fence", () => {
  test("only the server Application renders the image repository", () => {
    const deploying = current("retained-volume-restart");
    const definition = RecipeDefinitionSchema.parse(
      tsmc("retained-volume-restart"),
    );
    if (definition.kind !== "compound") throw new Error("TSMC is compound");
    const [companion, upgraded] = definition.subRecipes.map((sub) => {
      if (sub.definition.kind !== "kubernetes-application")
        throw new Error("TSMC sub-recipes are Applications");
      return renderApplication(deploying, sub.definition);
    });
    expect(companion?.source.helm?.parameters).toBeUndefined();
    expect(upgraded?.source.helm?.parameters).toEqual([
      { name: "image.repository", value: server.uri, forceString: true },
      {
        name: "image.tag",
        value: `1.2.3@sha256:${"d".repeat(64)}`,
        forceString: true,
      },
    ]);
  });

  test("sync does not require a preservation proof", () => {
    for (const mode of [
      "verified-restore",
      "retained-volume-restart",
    ] as const) {
      const definition = RecipeDefinitionSchema.parse(tsmc(mode));
      if (definition.kind !== "compound") throw new Error("TSMC is compound");
      const upgraded = definition.subRecipes[1]?.definition;
      if (upgraded?.kind !== "kubernetes-application")
        throw new Error("TSMC server is an Application");
      expect(() => minecraftSyncFence(current(mode), upgraded)).not.toThrow();
    }
  });
});
