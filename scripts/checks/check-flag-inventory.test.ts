import { describe, expect, test } from "vitest";
import {
  flagDeployments,
  type FlagDeployment,
} from "../../packages/feature-flags/src/deployments.ts";
import { selectFlagDeployments } from "../../packages/feature-flags/src/flags-drift.ts";
import { projectDeploymentFlags } from "../../packages/feature-flags/src/project-deployment.ts";
import {
  checkManagedFlagMatrix,
  declaredRolloutArguments,
  selectedManagedEnvironments,
  selectedManagedNamespaces,
} from "./check-flag-inventory.ts";

function alignedSnapshot(deployment: FlagDeployment) {
  return {
    deployment: deployment.id,
    revision: 1,
    flags: projectDeploymentFlags(deployment),
  };
}

describe("check-flag-inventory", () => {
  test("rollout modes accept --deployment or --environment/--namespace and reject mixed modes", () => {
    expect(
      declaredRolloutArguments([
        "--plan-declared",
        "--environment",
        "prod",
        "--namespace",
        "streambot",
        "--flag",
        "streambot-history-enabled",
      ]),
    ).toEqual({
      mode: "plan",
      deployment: {
        id: "streambot/prod",
        catalog: "streambot",
        stage: "prod",
      },
      flagKeys: ["streambot-history-enabled"],
    });

    expect(
      declaredRolloutArguments([
        "--apply-declared",
        "--deployment",
        "minecraft/tsmc",
        "--flag",
        "the-storm-rwf-enabled",
      ]),
    ).toEqual({
      mode: "apply",
      deployment: {
        id: "minecraft/tsmc",
        catalog: "the-storm",
        stage: "prod",
      },
      flagKeys: ["the-storm-rwf-enabled"],
    });

    for (const args of [
      ["--apply-declared"],
      ["--plan-declared", "--apply-declared"],
      ["--plan-declared", "--apply-missing"],
      ["--flag", "test"],
      ["--apply-declared", "--environment", "prod", "--namespace", "scout"],
      [
        "--apply-declared",
        "--deployment",
        "scout/prod",
        "--environment",
        "prod",
        "--flag",
        "dares_enabled",
      ],
      [
        "--plan-declared",
        "--environment",
        "beta",
        "--namespace",
        "temporal",
        "--flag",
        "temporal-agent-chat-photon-owners",
      ],
    ]) {
      expect(() => declaredRolloutArguments(args)).toThrow();
    }
  });

  test("checks all 21 active flag deployments by default", async () => {
    const loaded: string[] = [];
    const messages = await checkManagedFlagMatrix({
      loadSnapshot: (deployment) => {
        loaded.push(deployment.id);
        return Promise.resolve(alignedSnapshot(deployment));
      },
    });

    expect(loaded).toEqual(flagDeployments.map((deployment) => deployment.id));
    expect(loaded).toHaveLength(21);
    expect(messages).toHaveLength(21);
  });

  test("filters by --deployment or mapped --environment/--namespace and rejects unread pairs", async () => {
    const byDeployment: string[] = [];
    await checkManagedFlagMatrix({
      deploymentFilter: "minecraft/tsmc",
      loadSnapshot: (deployment) => {
        byDeployment.push(deployment.id);
        return Promise.resolve(alignedSnapshot(deployment));
      },
    });
    expect(byDeployment).toEqual(["minecraft/tsmc"]);

    const byLegacyPair: string[] = [];
    await checkManagedFlagMatrix({
      namespaceFilter: "the-storm",
      environmentFilter: "prod",
      loadSnapshot: (deployment) => {
        byLegacyPair.push(deployment.id);
        return Promise.resolve(alignedSnapshot(deployment));
      },
    });
    expect(byLegacyPair).toEqual(["minecraft/tsmc"]);

    expect(() => selectedManagedEnvironments("staging")).toThrow(
      /unknown managed environment filter: staging/,
    );
    expect(() => selectedManagedNamespaces("default")).toThrow(
      /unknown managed namespace filter: default/,
    );
    expect(() =>
      selectFlagDeployments({ deploymentFilter: "unknown/prod" }),
    ).toThrow(/unknown flag deployment filter: unknown\/prod/);
    expect(() =>
      selectFlagDeployments({
        environmentFilter: "beta",
        namespaceFilter: "temporal",
      }),
    ).toThrow(/no active flag deployment matches filter: beta\/temporal/);
  });

  test("names the failing deployment for malformed snapshots and drift", async () => {
    await expect(
      checkManagedFlagMatrix({
        deploymentFilter: "scout/prod",
        loadSnapshot: () =>
          Promise.resolve({ deployment: "scout/prod", revision: 1, flags: [] }),
      }),
    ).rejects.toThrow(/scout\/prod/);

    await expect(
      checkManagedFlagMatrix({
        deploymentFilter: "starlight-karma-bot/beta",
        loadSnapshot: () => Promise.resolve({ invalid: true }),
      }),
    ).rejects.toThrow(/starlight-karma-bot\/beta/);
  });

  test("checks the remaining deployments after one deployment fails", async () => {
    const loaded: string[] = [];
    await expect(
      checkManagedFlagMatrix({
        loadSnapshot: (deployment) => {
          loaded.push(deployment.id);
          return Promise.resolve(
            deployment.id === "scout/beta"
              ? { deployment: "scout/beta", revision: 1, flags: [] }
              : alignedSnapshot(deployment),
          );
        },
      }),
    ).rejects.toThrow(/scout\/beta/);
    expect(loaded).toHaveLength(flagDeployments.length);
  });
});
