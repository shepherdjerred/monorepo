import { describe, expect, test } from "vitest";
import { artifact, detail, recipe } from "#lib/delivery/model/testing.ts";
import { oracleEvidence } from "./oracle.ts";

const chart = artifact({
  id: "chart/1",
  component: "chart:arcade",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.1.tgz",
  version: "1.0.1",
  character: "b",
});
const definition = recipe(
  { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
  "chart:arcade",
);
const KEYS = ["step-apply-safety", "step-sync"];

describe("model acceptance (4.14, T3)", () => {
  test("one acceptance reconciles every settled frozen step", async () => {
    const current = detail(
      definition,
      chart,
      KEYS.map((key) => ({ key, status: "succeeded" })),
    );
    const evidence = await oracleEvidence(current, KEYS, []);
    expect(evidence.map((entry) => entry.kind)).toEqual([
      "reconciliation",
      "acceptance",
    ]);
    expect(evidence[0]?.summary).toContain("step-apply-safety, step-sync");
  });

  test("a step whose intent never settled is not accepted", async () => {
    const current = detail(definition, chart, [
      { key: "step-apply-safety", status: "succeeded" },
      { key: "step-sync", status: "running" },
    ]);
    await expect(oracleEvidence(current, KEYS, [])).rejects.toThrow(
      /step-sync have not settled/u,
    );
  });
});
