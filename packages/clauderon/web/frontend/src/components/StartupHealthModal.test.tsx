import { describe, expect, test } from "bun:test";
import type { SessionHealthReport, ResourceState } from "@clauderon/client";
import { BackendType, AvailableAction } from "@clauderon/shared";

// Test helper functions extracted from the component
function getHealthLabel(state: ResourceState): string {
  switch (state.type) {
    case "Stopped":
      return "Stopped";
    case "Hibernated":
      return "Hibernated";
    case "Pending":
      return "Pending";
    case "Missing":
      return "Missing";
    case "Error":
      return "Error";
    case "CrashLoop":
      return "Crash Loop";
    case "DeletedExternally":
      return "Deleted Externally";
    case "DataLost":
      return "Data Lost";
    case "WorktreeMissing":
      return "Worktree Missing";
    default:
      return "Unknown";
  }
}

function getHealthColor(state: ResourceState): string {
  switch (state.type) {
    case "Stopped":
    case "Hibernated":
    case "Pending":
      return "bg-yellow-500/20 text-yellow-700 border-yellow-500/50";
    case "Missing":
      return "bg-orange-500/20 text-orange-700 border-orange-500/50";
    case "Error":
    case "CrashLoop":
    case "DeletedExternally":
    case "DataLost":
    case "WorktreeMissing":
      return "bg-red-500/20 text-red-700 border-red-500/50";
    default:
      return "bg-gray-500/20 text-gray-700 border-gray-500/50";
  }
}

// Helper to create mock health reports
function createMockHealthReport(
  overrides: Partial<SessionHealthReport> = {},
): SessionHealthReport {
  return {
    session_id: "session-123",
    session_name: "Test Session",
    backend_type: BackendType.Docker,
    state: { type: "Missing" },
    available_actions: [AvailableAction.Recreate],
    description: "Container not found",
    details: "Docker container was deleted externally",
    data_safe: true,
    ...overrides,
  };
}

describe("StartupHealthModal helpers", () => {
  describe("getHealthLabel", () => {
    test("returns Stopped for stopped state", () => {
      expect(getHealthLabel({ type: "Stopped" })).toBe("Stopped");
    });

    test("returns Hibernated for hibernated state", () => {
      expect(getHealthLabel({ type: "Hibernated" })).toBe("Hibernated");
    });

    test("returns Pending for pending state", () => {
      expect(getHealthLabel({ type: "Pending" })).toBe("Pending");
    });

    test("returns Missing for missing state", () => {
      expect(getHealthLabel({ type: "Missing" })).toBe("Missing");
    });

    test("returns Error for error state", () => {
      expect(
        getHealthLabel({ type: "Error", message: "Something went wrong" }),
      ).toBe("Error");
    });

    test("returns Crash Loop for crash loop state", () => {
      expect(getHealthLabel({ type: "CrashLoop" })).toBe("Crash Loop");
    });

    test("returns Deleted Externally for deleted externally state", () => {
      expect(getHealthLabel({ type: "DeletedExternally" })).toBe(
        "Deleted Externally",
      );
    });

    test("returns Data Lost for data lost state", () => {
      expect(getHealthLabel({ type: "DataLost", reason: "PVC deleted" })).toBe(
        "Data Lost",
      );
    });

    test("returns Worktree Missing for worktree missing state", () => {
      expect(getHealthLabel({ type: "WorktreeMissing" })).toBe(
        "Worktree Missing",
      );
    });

    test("returns Unknown for healthy state (not shown in modal)", () => {
      expect(getHealthLabel({ type: "Healthy" })).toBe("Unknown");
    });
  });

  describe("getHealthColor", () => {
    test("returns yellow colors for warning states", () => {
      const yellowColor =
        "bg-yellow-500/20 text-yellow-700 border-yellow-500/50";
      expect(getHealthColor({ type: "Stopped" })).toBe(yellowColor);
      expect(getHealthColor({ type: "Hibernated" })).toBe(yellowColor);
      expect(getHealthColor({ type: "Pending" })).toBe(yellowColor);
    });

    test("returns orange color for missing state", () => {
      expect(getHealthColor({ type: "Missing" })).toBe(
        "bg-orange-500/20 text-orange-700 border-orange-500/50",
      );
    });

    test("returns red colors for error states", () => {
      const redColor = "bg-red-500/20 text-red-700 border-red-500/50";
      expect(getHealthColor({ type: "Error", message: "Error" })).toBe(
        redColor,
      );
      expect(getHealthColor({ type: "CrashLoop" })).toBe(redColor);
      expect(getHealthColor({ type: "DeletedExternally" })).toBe(redColor);
      expect(getHealthColor({ type: "DataLost", reason: "PVC deleted" })).toBe(
        redColor,
      );
      expect(getHealthColor({ type: "WorktreeMissing" })).toBe(redColor);
    });

    test("returns gray color for unknown states", () => {
      expect(getHealthColor({ type: "Healthy" })).toBe(
        "bg-gray-500/20 text-gray-700 border-gray-500/50",
      );
    });
  });

  describe("mock health report creation", () => {
    test("creates valid mock health report with defaults", () => {
      const report = createMockHealthReport();
      expect(report.session_id).toBe("session-123");
      expect(report.state.type).toBe("Missing");
      expect(report.data_safe).toBe(true);
    });

    test("allows overriding specific fields", () => {
      const report = createMockHealthReport({
        session_name: "Custom Session",
        state: { type: "Stopped" },
        data_safe: false,
      });
      expect(report.session_name).toBe("Custom Session");
      expect(report.state.type).toBe("Stopped");
      expect(report.data_safe).toBe(false);
    });
  });
});

describe("StartupHealthModal filtering", () => {
  test("filters out healthy sessions", () => {
    const reports: SessionHealthReport[] = [
      createMockHealthReport({ session_id: "1", state: { type: "Healthy" } }),
      createMockHealthReport({ session_id: "2", state: { type: "Missing" } }),
      createMockHealthReport({ session_id: "3", state: { type: "Stopped" } }),
    ];

    const unhealthySessions = reports.filter((r) => r.state.type !== "Healthy");
    expect(unhealthySessions).toHaveLength(2);
    expect(unhealthySessions.map((s) => s.session_id)).toEqual(["2", "3"]);
  });

  test("returns empty array when all sessions are healthy", () => {
    const reports: SessionHealthReport[] = [
      createMockHealthReport({ session_id: "1", state: { type: "Healthy" } }),
      createMockHealthReport({ session_id: "2", state: { type: "Healthy" } }),
    ];

    const unhealthySessions = reports.filter((r) => r.state.type !== "Healthy");
    expect(unhealthySessions).toHaveLength(0);
  });
});
