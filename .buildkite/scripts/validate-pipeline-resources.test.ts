import { describe, expect, test } from "vitest";

import { validateExhaustiveGraphCapacity } from "./validate-pipeline-resources.ts";

const measuredCapacity = [
  "--concurrency=4",
  'requests: { cpu: "1", memory: "18Gi", ephemeral-storage: "2Gi" }',
  'limits: { cpu: "7", memory: "24Gi", ephemeral-storage: "40Gi" }',
].join("\n");

describe("exhaustive graph capacity contract", () => {
  test("accepts the measured concurrency and memory budget", () => {
    expect(() =>
      validateExhaustiveGraphCapacity(measuredCapacity, "verify"),
    ).not.toThrow();
  });

  test("rejects six-way concurrency that reproduces the cold-graph OOM", () => {
    expect(() =>
      validateExhaustiveGraphCapacity(
        measuredCapacity.replace("--concurrency=4", "--concurrency=6"),
        "verify",
      ),
    ).toThrow("verify is missing measured capacity contract --concurrency=4");
  });

  test("rejects the exhausted 20 GiB burst limit", () => {
    expect(() =>
      validateExhaustiveGraphCapacity(
        measuredCapacity.replace('memory: "24Gi"', 'memory: "20Gi"'),
        "verify",
      ),
    ).toThrow(
      'verify is missing measured capacity contract { cpu: "7", memory: "24Gi", ephemeral-storage: "40Gi" }',
    );
  });
});
