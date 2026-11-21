import { describe, expect, test } from "vitest";
import { flagDeploymentForSelector, flagDeployments } from "./deployments.ts";

describe("flag deployments", () => {
  test("ids and Flipt selectors are unique", () => {
    const ids = flagDeployments.map((deployment) => deployment.id);
    const selectors = flagDeployments.map(
      (deployment) => `${deployment.catalog}/${deployment.fliptEnvironment}`,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  test("only Scout and Karma have a second stage", () => {
    const beta = flagDeployments
      .filter((deployment) => deployment.fliptEnvironment === "beta")
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
