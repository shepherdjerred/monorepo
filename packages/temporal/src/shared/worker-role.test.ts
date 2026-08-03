import { describe, expect, it } from "bun:test";
import {
  parseWorkerRole,
  workerRoleRunsCore,
  workerRoleRunsGlitter,
} from "./worker-role.ts";

describe("Temporal worker role", () => {
  it("defaults to the backward-compatible all role", () => {
    expect(parseWorkerRole(undefined)).toBe("all");
  });

  it.each(["all", "core", "glitter"])("accepts the %s role", (role) => {
    expect(parseWorkerRole(role)).toBe(role);
  });

  it("fails fast for an unknown role", () => {
    expect(() => parseWorkerRole("unknown")).toThrow();
  });

  it("maps roles to their isolated worker groups", () => {
    expect(workerRoleRunsCore("all")).toBe(true);
    expect(workerRoleRunsGlitter("all")).toBe(true);
    expect(workerRoleRunsCore("core")).toBe(true);
    expect(workerRoleRunsGlitter("core")).toBe(false);
    expect(workerRoleRunsCore("glitter")).toBe(false);
    expect(workerRoleRunsGlitter("glitter")).toBe(true);
  });
});
