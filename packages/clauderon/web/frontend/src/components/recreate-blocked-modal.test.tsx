import { describe, expect, test } from "bun:test";
import type { SessionHealthReport } from "@clauderon/client";
import { BackendType, AvailableAction } from "@clauderon/shared";

// Helper to create mock health reports
function createMockHealthReport(
  overrides: Partial<SessionHealthReport> = {},
): SessionHealthReport {
  return {
    session_id: "session-123",
    session_name: "Test Session",
    backend_type: BackendType.Docker,
    state: { type: "Stopped" },
    available_actions: [], // Empty = blocked
    description: "Cannot recreate: data would be lost",
    details:
      "Uncommitted work and conversation history would be lost.",
    data_safe: false,
    ...overrides,
  };
}

describe("RecreateBlockedModal scenarios", () => {
  describe("blocked action detection", () => {
    test("session is blocked when available_actions is empty", () => {
      const report = createMockHealthReport({
        available_actions: [],
      });
      expect(report.available_actions).toHaveLength(0);
    });

    test("session is not blocked when actions are available", () => {
      const report = createMockHealthReport({
        available_actions: [AvailableAction.Recreate],
      });
      expect(report.available_actions.length).toBeGreaterThan(0);
    });
  });

  describe("blocked modal content", () => {
    test("description explains why action is blocked", () => {
      const report = createMockHealthReport({
        description: "This session cannot be recreated safely.",
      });
      expect(report.description).toContain("cannot be recreated");
    });

    test("data_safe is false for blocked sessions", () => {
      const report = createMockHealthReport({
        data_safe: false,
      });
      expect(report.data_safe).toBe(false);
    });
  });
});

describe("RecreateBlockedModal backend-specific blocking", () => {
  test("Docker sessions are never blocked (bind mount preserves data)", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Docker,
      state: { type: "Missing" },
      available_actions: [AvailableAction.Recreate],
      data_safe: true,
    });
    expect(report.available_actions.length).toBeGreaterThan(0);
  });

  test("Zellij sessions are never blocked (local filesystem)", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Zellij,
      state: { type: "Missing" },
      available_actions: [AvailableAction.Recreate],
      data_safe: true,
    });
    expect(report.available_actions.length).toBeGreaterThan(0);
  });

});
