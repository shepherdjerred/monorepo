import { describe, expect, it } from "vitest";
import {
  parseWorkerRole,
  workerRoleRunsAgent,
  workerRoleRunsGlitter,
  workerRoleRunsMaintenance,
} from "./worker-role.ts";

describe("Temporal worker role", () => {
  it("defaults to the backward-compatible all role", () => {
    expect(parseWorkerRole(undefined)).toBe("all");
  });

  it.each([
    "all",
    "agent",
    "backup",
    "control",
    "glitter",
    "glitter-context",
    "glitter-corpus",
    "home",
    "infra",
    "maintenance",
    "repo",
    "reports",
    "scout",
    "workflows",
  ])("accepts the %s role", (role) => {
    expect(parseWorkerRole(role)).toBe(role);
  });

  it("fails fast for an unknown role", () => {
    expect(() => parseWorkerRole("unknown")).toThrow();
  });

  it("maps roles to their isolated worker groups", () => {
    expect(workerRoleRunsAgent("all")).toBe(true);
    expect(workerRoleRunsGlitter("all")).toBe(true);
    expect(workerRoleRunsAgent("agent")).toBe(true);
    expect(workerRoleRunsGlitter("glitter")).toBe(true);
    expect(workerRoleRunsMaintenance("all")).toBe(true);
    expect(workerRoleRunsMaintenance("maintenance")).toBe(true);
    expect(workerRoleRunsMaintenance("glitter")).toBe(false);
  });
});
