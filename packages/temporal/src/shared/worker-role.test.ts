import { describe, expect, it } from "vitest";
import {
  parseWorkerRole,
  workerRoleRunsAgent,
  workerRoleRunsCore,
  workerRoleRunsGlitter,
  workerRoleRunsMaintenance,
} from "./worker-role.ts";

describe("Temporal worker role", () => {
  it("defaults to the backward-compatible all role", () => {
    expect(parseWorkerRole(undefined)).toBe("all");
  });

  it.each(["all", "agent", "core", "glitter", "maintenance"])(
    "accepts the %s role",
    (role) => {
      expect(parseWorkerRole(role)).toBe(role);
    },
  );

  it("fails fast for an unknown role", () => {
    expect(() => parseWorkerRole("unknown")).toThrow();
  });

  it("maps roles to their isolated worker groups", () => {
    expect(workerRoleRunsCore("all")).toBe(true);
    expect(workerRoleRunsAgent("all")).toBe(true);
    expect(workerRoleRunsGlitter("all")).toBe(true);
    expect(workerRoleRunsAgent("agent")).toBe(true);
    expect(workerRoleRunsCore("agent")).toBe(false);
    expect(workerRoleRunsCore("core")).toBe(true);
    expect(workerRoleRunsAgent("core")).toBe(false);
    expect(workerRoleRunsGlitter("core")).toBe(false);
    expect(workerRoleRunsCore("glitter")).toBe(false);
    expect(workerRoleRunsGlitter("glitter")).toBe(true);
    expect(workerRoleRunsMaintenance("all")).toBe(true);
    expect(workerRoleRunsMaintenance("maintenance")).toBe(true);
    expect(workerRoleRunsMaintenance("core")).toBe(false);
    expect(workerRoleRunsMaintenance("glitter")).toBe(false);
  });
});
