import { describe, expect, it } from "vitest";
import { buildStatus, combinedStatus, executionStatus } from "./status.ts";
import { promotionOrder } from "./topology.ts";

describe("execution status", () => {
  it("lets a failed or pending build decide", () => {
    expect(executionStatus("failed", ["succeeded"])).toBe("failed");
    expect(executionStatus("pending", [])).toBe("pending");
  });

  it("reports the most urgent environment status", () => {
    expect(executionStatus("succeeded", ["succeeded", "running"])).toBe(
      "running",
    );
    expect(
      executionStatus("succeeded", ["awaiting_approval", "succeeded"]),
    ).toBe("awaiting_approval");
    expect(executionStatus("succeeded", ["canceled", "succeeded"])).toBe(
      "succeeded",
    );
    expect(executionStatus("succeeded", ["canceled"])).toBe("canceled");
    expect(executionStatus(null, [])).toBe("not_started");
  });

  it("rejects unknown build statuses", () => {
    expect(() => buildStatus("mystery")).toThrow("Unknown build status");
    expect(combinedStatus([])).toBe("not_started");
  });
});

function env(id: string, source: string | null) {
  return {
    id,
    name: id.split("/")[1] ?? id,
    promotionSourceEnvironmentId: source,
  };
}

describe("promotionOrder", () => {
  it("orders sources before targets and siblings by name", () => {
    expect(
      promotionOrder([
        env("svc/prod", "svc/beta"),
        env("svc/beta", null),
        env("svc/canary", "svc/beta"),
        env("svc/alpha", null),
      ]).map((entry) => entry.id),
    ).toEqual(["svc/alpha", "svc/beta", "svc/canary", "svc/prod"]);
  });

  it("treats a foreign source as a root", () => {
    expect(
      promotionOrder([env("svc/prod", "other/beta")]).map((entry) => entry.id),
    ).toEqual(["svc/prod"]);
  });

  it("fails on a promotion cycle", () => {
    expect(() =>
      promotionOrder([env("svc/a", "svc/b"), env("svc/b", "svc/a")]),
    ).toThrow("cycle");
  });
});
