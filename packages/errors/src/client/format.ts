import type { Severity } from "@shepherdjerred/console-ui";
import {
  DEFAULT_TRACKER_BASE_URL,
  type IssueListItem,
  type IssueState,
  type StackFrameView,
} from "#shared/contract.ts";

const COUNT_FORMATTER = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return COUNT_FORMATTER.format(value);
}

export function formatAge(iso: string | null, nowMs = Date.now()): string {
  if (iso === null || iso.length === 0) {
    return "—";
  }
  const timestampMs = Date.parse(iso);
  if (!Number.isFinite(timestampMs)) {
    return iso;
  }
  const diffSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSeconds < 45) {
    return "just now";
  }
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${String(days)}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${String(months)}mo ago`;
  }
  const years = Math.floor(days / 365);
  return `${String(years)}y ago`;
}

export function formatTimestamp(iso: string | null): string {
  if (iso === null || iso.length === 0) {
    return "—";
  }
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/u, " UTC");
}

export function issueSeverity(
  issue: Pick<IssueListItem, "state" | "regressedCount" | "level">,
): Severity {
  if (issue.state === "MUTED") {
    return "unknown";
  }
  if (issue.state === "RESOLVED" || issue.state === "RESOLVED_NEXT_RELEASE") {
    return "ok";
  }
  if (
    issue.regressedCount > 0 ||
    issue.level === "fatal" ||
    issue.level === "error"
  ) {
    return "error";
  }
  return issue.level === "warning" ? "warning" : "info";
}

export function issueStateLabel(state: IssueState): string {
  switch (state) {
    case "OPEN":
      return "Unresolved";
    case "RESOLVED":
      return "Resolved";
    case "RESOLVED_NEXT_RELEASE":
      return "Next release";
    case "MUTED":
      return "Muted";
  }
}

export function issueGlyphLabel(
  issue: Pick<IssueListItem, "state" | "regressedCount" | "level">,
): string {
  if (issue.state === "MUTED") {
    return "Muted";
  }
  if (issue.state === "RESOLVED") {
    return "Resolved";
  }
  if (issue.state === "RESOLVED_NEXT_RELEASE") {
    return "Resolved in next release";
  }
  if (issue.regressedCount > 0) {
    return "Regressed";
  }
  if (issue.level === "fatal") {
    return "Fatal";
  }
  if (issue.level === "warning") {
    return "Warning";
  }
  return issue.level === "error" ? "Error" : "Info";
}

export function trackerIssueUrl(identifier: string): string {
  return `${DEFAULT_TRACKER_BASE_URL}/AI/issues/${encodeURIComponent(identifier)}`;
}

export type GroupedStackFrame =
  | {
      readonly kind: "app";
      readonly frame: StackFrameView;
      readonly index: number;
    }
  | {
      readonly kind: "vendor";
      readonly frames: readonly StackFrameView[];
      readonly startIndex: number;
    };

export function groupStackFrames(
  frames: readonly StackFrameView[],
): readonly GroupedStackFrame[] {
  const groups: GroupedStackFrame[] = [];
  let vendorBuffer: StackFrameView[] = [];
  let vendorStart = 0;

  const flushVendor = (): void => {
    if (vendorBuffer.length > 0) {
      groups.push({
        kind: "vendor",
        frames: vendorBuffer,
        startIndex: vendorStart,
      });
      vendorBuffer = [];
    }
  };

  for (const [index, frame] of frames.entries()) {
    if (frame.inApp) {
      flushVendor();
      groups.push({ kind: "app", frame, index });
    } else {
      if (vendorBuffer.length === 0) {
        vendorStart = index;
      }
      vendorBuffer.push(frame);
    }
  }
  flushVendor();
  return groups;
}
