import * as ciWorkspaceReaper from "#workflows/ci/ci-workspace-reaper.ts";
import * as trackerAttachments from "#workflows/maintenance/tracker-attachments.ts";

export const runCiWorkspaceReaperWorkflow =
  ciWorkspaceReaper.runCiWorkspaceReaperWorkflow;
export const trackerCleanup = trackerAttachments.runTrackerAttachmentCleanup;
