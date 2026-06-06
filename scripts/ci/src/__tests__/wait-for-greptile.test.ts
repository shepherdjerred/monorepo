import { describe, expect, it } from "bun:test";
import {
  evaluateGreptileSignals,
  type GreptileSignal,
} from "../wait-for-greptile.ts";

function greptileCheck(input: {
  status: string;
  conclusion: GreptileSignal["conclusion"];
}): GreptileSignal {
  return {
    source: "check-run",
    name: "Greptile",
    status: input.status,
    conclusion: input.conclusion,
    url: "https://github.com/shepherdjerred/monorepo/runs/1",
    updatedAt: "2026-06-05T12:00:00Z",
  };
}

describe("evaluateGreptileSignals", () => {
  it("waits when no Greptile status has been reported", () => {
    const result = evaluateGreptileSignals([
      {
        source: "check-run",
        name: "Buildkite / CI Complete",
        status: "completed",
        conclusion: "success",
        url: null,
        updatedAt: null,
      },
    ]);

    expect(result.state).toBe("waiting");
    expect(result.message).toContain("No Greptile");
  });

  it("waits while Greptile is running", () => {
    const result = evaluateGreptileSignals([
      greptileCheck({ status: "in_progress", conclusion: null }),
    ]);

    expect(result.state).toBe("waiting");
    expect(result.message).toContain("in_progress");
  });

  it("waits when Greptile has completed with non-success comments", () => {
    const result = evaluateGreptileSignals([
      greptileCheck({ status: "completed", conclusion: "failure" }),
    ]);

    expect(result.state).toBe("waiting");
    expect(result.message).toContain("failure");
  });

  it("passes when Greptile's check run succeeds", () => {
    const result = evaluateGreptileSignals([
      greptileCheck({ status: "completed", conclusion: "success" }),
    ]);

    expect(result.state).toBe("passed");
    expect(result.message).toContain("Greptile is green");
  });

  it("passes when Greptile reports a successful commit status", () => {
    const result = evaluateGreptileSignals([
      {
        source: "commit-status",
        name: "greptile/review",
        status: "success",
        conclusion: "success",
        url: null,
        updatedAt: null,
      },
    ]);

    expect(result.state).toBe("passed");
  });
});
