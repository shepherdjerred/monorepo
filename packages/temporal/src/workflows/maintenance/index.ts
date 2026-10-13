import * as ciIoTelemetry from "#workflows/ci/ci-io-telemetry.ts";
import * as ciWorkspaceReaper from "#workflows/ci/ci-workspace-reaper.ts";
import * as trackerAttachments from "#workflows/maintenance/tracker-attachments.ts";

export const runCiIoTelemetry = ciIoTelemetry.runCiIoTelemetry;
export const runCiWorkspaceReaperWorkflow =
  ciWorkspaceReaper.runCiWorkspaceReaperWorkflow;
export const trackerCleanup = trackerAttachments.runTrackerAttachmentCleanup;
