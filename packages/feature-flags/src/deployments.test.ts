import { describe, expect, test } from "vitest";
import { flagDeploymentForSelector, flagDeployments } from "./deployments.ts";

describe("flag deployments", () => {
  test("ids and catalog/stage selectors are unique", () => {
    const ids = flagDeployments.map((deployment) => deployment.id);
    const selectors = flagDeployments.map(
      (deployment) => `${deployment.catalog}/${deployment.stage}`,
    );
    expect(flagDeployments).toHaveLength(17);
    expect(ids).toEqual([...ids].toSorted());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(selectors).size).toBe(selectors.length);
    expect(flagDeploymentForSelector("golink", "prod")?.id).toBe("golink/prod");
  });

  test("only Scout and Karma have a second stage", () => {
    const beta = flagDeployments
      .filter((deployment) => deployment.stage === "beta")
      .map((deployment) => deployment.catalog)
      .toSorted();
    expect(beta).toEqual(["scout", "starlight-karma-bot"]);
    expect(flagDeploymentForSelector("storm", "beta")).toBeUndefined();
    expect(flagDeploymentForSelector("storm", "prod")?.id).toBe("storm/prod");
  });

  test("the Temporal gateway's beta read is not a deployment", () => {
    expect(flagDeploymentForSelector("temporal", "beta")).toBeUndefined();
    expect(flagDeploymentForSelector("temporal", "prod")?.id).toBe(
      "temporal/prod",
    );
  });

  test("a prod-only catalog has no beta document", () => {
    expect(flagDeploymentForSelector("streambot", "beta")).toBeUndefined();
    expect(flagDeploymentForSelector("streambot", "prod")?.id).toBe(
      "streambot/prod",
    );
    expect(flagDeploymentForSelector("the-storm", "prod")?.id).toBe(
      "minecraft/tsmc",
    );
  });
});
