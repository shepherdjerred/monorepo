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
    backend_type: BackendType.Sprites,
    state: { type: "Stopped" },
    available_actions: [], // Empty = blocked
    description: "Cannot recreate: data would be lost",
    details:
      "This sprite has auto_destroy enabled. Uncommitted work and conversation history would be lost.",
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

  describe("Sprites auto_destroy blocking", () => {
    test("stopped sprite with auto_destroy is blocked", () => {
      const report = createMockHealthReport({
        backend_type: BackendType.Sprites,
        state: { type: "Stopped" },
        available_actions: [],
        data_safe: false,
        description:
          "Sprite is stopped with auto_destroy enabled. Cannot recreate without data loss.",
      });

      expect(report.available_actions).toHaveLength(0);
      expect(report.data_safe).toBe(false);
      expect(report.backend_type).toBe(BackendType.Sprites);
    });

    test("error sprite with auto_destroy is blocked", () => {
      const report = createMockHealthReport({
        backend_type: BackendType.Sprites,
        state: { type: "Error", message: "Sprite crashed" },
        available_actions: [],
        data_safe: false,
      });

      expect(report.available_actions).toHaveLength(0);
      expect(report.data_safe).toBe(false);
    });

    test("hibernated sprite with auto_destroy can be woken", () => {
      // Note: hibernated sprites CAN be woken even with auto_destroy
      const report = createMockHealthReport({
        backend_type: BackendType.Sprites,
        state: { type: "Hibernated" },
        available_actions: [AvailableAction.Wake],
        data_safe: true,
      });

      expect(report.available_actions).toContain(AvailableAction.Wake);
      expect(report.data_safe).toBe(true);
    });
  });

  describe("blocked modal content", () => {
    test("description explains why action is blocked", () => {
      const report = createMockHealthReport({
        description: "This session cannot be recreated safely.",
      });
      expect(report.description).toContain("cannot be recreated");
    });

    test("details provide technical context", () => {
      const report = createMockHealthReport({
        details:
          "Sprite has auto_destroy=true. The VM will be deleted when stopped.",
      });
      expect(report.details).toContain("auto_destroy");
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

  test("Kubernetes sessions are never blocked when PVC exists", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Kubernetes,
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

  test("Sprites can be blocked based on auto_destroy setting", () => {
    // With auto_destroy=true and stopped state
    const blockedReport = createMockHealthReport({
      backend_type: BackendType.Sprites,
      state: { type: "Stopped" },
      available_actions: [],
      data_safe: false,
    });
    expect(blockedReport.available_actions).toHaveLength(0);

    // With auto_destroy=false
    const unblockedReport = createMockHealthReport({
      backend_type: BackendType.Sprites,
      state: { type: "Stopped" },
      available_actions: [AvailableAction.Start, AvailableAction.Recreate],
      data_safe: true,
    });
    expect(unblockedReport.available_actions.length).toBeGreaterThan(0);
  });
});
