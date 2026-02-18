import { describe, expect, test } from "bun:test";
import type { ResourceState, SessionHealthReport } from "@clauderon/client";
import { BackendType, AvailableAction } from "@clauderon/shared";

// Test helper functions extracted from the component
function getStateDisplay(state: ResourceState): {
  label: string;
  color: string;
} {
  switch (state.type) {
    case "Healthy":
      return { label: "OK", color: "text-green-600" };
    case "Stopped":
      return { label: "Stopped", color: "text-yellow-600" };
    case "Hibernated":
      return { label: "Hibernated", color: "text-blue-600" };
    case "Pending":
      return { label: "Pending", color: "text-yellow-600" };
    case "Missing":
      return { label: "Missing", color: "text-orange-600" };
    case "Error":
      return { label: "Error", color: "text-red-600" };
    case "CrashLoop":
      return { label: "Crash Loop", color: "text-red-600" };
    case "DeletedExternally":
      return { label: "Deleted Externally", color: "text-red-600" };
    case "DataLost":
      return { label: "Data Lost", color: "text-red-600" };
    case "WorktreeMissing":
      return { label: "Worktree Missing", color: "text-red-600" };
    default:
      return { label: "Unknown", color: "text-gray-600" };
  }
}

function getActionDetails(action: AvailableAction): {
  label: string;
  variant: string;
} {
  switch (action) {
    case AvailableAction.Start:
      return { label: "Start", variant: "brutalist" };
    case AvailableAction.Wake:
      return { label: "Wake", variant: "brutalist" };
    case AvailableAction.Recreate:
      return { label: "Recreate", variant: "brutalist" };
    case AvailableAction.RecreateFresh:
      return { label: "Recreate Fresh", variant: "destructive" };
    case AvailableAction.UpdateImage:
      return { label: "Update Image", variant: "brutalist" };
    case AvailableAction.Cleanup:
      return { label: "Clean Up", variant: "destructive" };
    default:
      return { label: action, variant: "outline" };
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

describe("RecreateConfirmModal helpers", () => {
  describe("getStateDisplay", () => {
    test("returns correct display for Healthy state", () => {
      const display = getStateDisplay({ type: "Healthy" });
      expect(display.label).toBe("OK");
      expect(display.color).toBe("text-green-600");
    });

    test("returns correct display for Stopped state", () => {
      const display = getStateDisplay({ type: "Stopped" });
      expect(display.label).toBe("Stopped");
      expect(display.color).toBe("text-yellow-600");
    });

    test("returns correct display for Hibernated state", () => {
      const display = getStateDisplay({ type: "Hibernated" });
      expect(display.label).toBe("Hibernated");
      expect(display.color).toBe("text-blue-600");
    });

    test("returns correct display for Missing state", () => {
      const display = getStateDisplay({ type: "Missing" });
      expect(display.label).toBe("Missing");
      expect(display.color).toBe("text-orange-600");
    });

    test("returns correct display for Error state", () => {
      const display = getStateDisplay({
        type: "Error",
        message: "Something broke",
      });
      expect(display.label).toBe("Error");
      expect(display.color).toBe("text-red-600");
    });

    test("returns correct display for CrashLoop state", () => {
      const display = getStateDisplay({ type: "CrashLoop" });
      expect(display.label).toBe("Crash Loop");
      expect(display.color).toBe("text-red-600");
    });

    test("returns correct display for DataLost state", () => {
      const display = getStateDisplay({
        type: "DataLost",
        reason: "PVC deleted",
      });
      expect(display.label).toBe("Data Lost");
      expect(display.color).toBe("text-red-600");
    });
  });

  describe("getActionDetails", () => {
    test("returns correct details for Start action", () => {
      const details = getActionDetails(AvailableAction.Start);
      expect(details.label).toBe("Start");
      expect(details.variant).toBe("brutalist");
    });

    test("returns correct details for Wake action", () => {
      const details = getActionDetails(AvailableAction.Wake);
      expect(details.label).toBe("Wake");
      expect(details.variant).toBe("brutalist");
    });

    test("returns correct details for Recreate action", () => {
      const details = getActionDetails(AvailableAction.Recreate);
      expect(details.label).toBe("Recreate");
      expect(details.variant).toBe("brutalist");
    });

    test("returns destructive variant for RecreateFresh action", () => {
      const details = getActionDetails(AvailableAction.RecreateFresh);
      expect(details.label).toBe("Recreate Fresh");
      expect(details.variant).toBe("destructive");
    });

    test("returns correct details for UpdateImage action", () => {
      const details = getActionDetails(AvailableAction.UpdateImage);
      expect(details.label).toBe("Update Image");
      expect(details.variant).toBe("brutalist");
    });

    test("returns destructive variant for Cleanup action", () => {
      const details = getActionDetails(AvailableAction.Cleanup);
      expect(details.label).toBe("Clean Up");
      expect(details.variant).toBe("destructive");
    });
  });
});

describe("RecreateConfirmModal action availability", () => {
  test("stopped container offers Start and Recreate", () => {
    const report = createMockHealthReport({
      state: { type: "Stopped" },
      available_actions: [AvailableAction.Start, AvailableAction.Recreate],
    });
    expect(report.available_actions).toContain(AvailableAction.Start);
    expect(report.available_actions).toContain(AvailableAction.Recreate);
  });

  test("missing container offers Recreate", () => {
    const report = createMockHealthReport({
      state: { type: "Missing" },
      available_actions: [AvailableAction.Recreate],
    });
    expect(report.available_actions).toContain(AvailableAction.Recreate);
    expect(report.available_actions).not.toContain(AvailableAction.Start);
  });

  test("hibernated sprite offers Wake and Recreate", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Sprites,
      state: { type: "Hibernated" },
      available_actions: [AvailableAction.Wake, AvailableAction.Recreate],
    });
    expect(report.available_actions).toContain(AvailableAction.Wake);
    expect(report.available_actions).toContain(AvailableAction.Recreate);
  });

  test("data lost offers Cleanup and RecreateFresh", () => {
    const report = createMockHealthReport({
      state: { type: "DataLost", reason: "PVC was deleted" },
      available_actions: [
        AvailableAction.Cleanup,
        AvailableAction.RecreateFresh,
      ],
      data_safe: false,
    });
    expect(report.available_actions).toContain(AvailableAction.Cleanup);
    expect(report.available_actions).toContain(AvailableAction.RecreateFresh);
    expect(report.data_safe).toBe(false);
  });

  test("healthy session offers UpdateImage and Recreate for proactive recreate", () => {
    const report = createMockHealthReport({
      state: { type: "Healthy" },
      available_actions: [
        AvailableAction.UpdateImage,
        AvailableAction.Recreate,
      ],
    });
    expect(report.available_actions).toContain(AvailableAction.UpdateImage);
    expect(report.available_actions).toContain(AvailableAction.Recreate);
  });

  test("worktree missing offers Cleanup", () => {
    const report = createMockHealthReport({
      state: { type: "WorktreeMissing" },
      available_actions: [AvailableAction.Cleanup],
      data_safe: false,
    });
    expect(report.available_actions).toContain(AvailableAction.Cleanup);
    expect(report.available_actions).toHaveLength(1);
  });
});

describe("RecreateConfirmModal data safety", () => {
  test("Docker bind mount recreate is data safe", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Docker,
      state: { type: "Missing" },
      data_safe: true,
      description:
        "Container not found. Your code is safe (mounted from host).",
    });
    expect(report.data_safe).toBe(true);
  });

  test("Kubernetes recreate is data safe when PVC exists", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Kubernetes,
      state: { type: "Missing" },
      data_safe: true,
      description: "Pod not found. Your code is safe (stored in PVC).",
    });
    expect(report.data_safe).toBe(true);
  });

  test("Kubernetes PVC deleted is not data safe", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Kubernetes,
      state: { type: "DataLost", reason: "PVC was deleted" },
      data_safe: false,
    });
    expect(report.data_safe).toBe(false);
  });

  test("Zellij recreate is data safe", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Zellij,
      state: { type: "Missing" },
      data_safe: true,
      description:
        "Zellij session not found. Your code is safe (stored locally).",
    });
    expect(report.data_safe).toBe(true);
  });

  test("Sprites with auto_destroy is not data safe", () => {
    const report = createMockHealthReport({
      backend_type: BackendType.Sprites,
      state: { type: "Stopped" },
      data_safe: false,
      description:
        "Sprite stopped with auto_destroy enabled. Data would be lost.",
    });
    expect(report.data_safe).toBe(false);
  });
});
