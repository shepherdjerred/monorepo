/**
 * Parser for the Renovate Dependency Dashboard issue body. Renovate marks each
 * actionable checkbox with an HTML comment such as
 * `<!-- approve-branch=renovate/foo -->`, followed by the PR title, and also
 * emits deprecation tables, lookup warning callouts, and ignored sections.
 */

import {
  extractPackageAndVersion,
  inferEcosystem,
  inferUpdateType,
  parseDeprecationRows,
  parseLookupWarnings,
  stripOuterMarkdownLink,
} from "@shepherdjerred/ops-clients/renovate-helpers.ts";

export const DEPENDENCY_DASHBOARD_TITLE = "Dependency Dashboard";

export const RENOVATE_UPDATE_STATES = [
  "awaiting-approval",
  "pending-checks",
  "rate-limited",
  "awaiting-schedule",
  "errored",
  "edited-blocked",
  "ignored",
] as const;

export type RenovateUpdateState = (typeof RENOVATE_UPDATE_STATES)[number];

export type RenovateUpdateType =
  "major" | "minor" | "patch" | "digest" | "pin" | "unknown";

export type RenovateUpdate = {
  state: RenovateUpdateState;
  branch: string;
  title: string;
  checked: boolean;
  packageName: string | undefined;
  targetVersion: string | undefined;
  ecosystem: string | undefined;
  updateType: RenovateUpdateType;
};

export type RenovateDeprecation = {
  datasource: string;
  packageName: string;
  packageUrl: string | undefined;
  replacement: string | undefined;
  replacementAvailable: boolean;
};

export type DependencyDashboard = {
  updates: RenovateUpdate[];
  counts: Record<RenovateUpdateState, number>;
  deprecations: RenovateDeprecation[];
  lookupWarnings: string[];
  truncated: boolean;
};

const TRUNCATED_BODY_LENGTH = 60_000;

const MARKER_STATES: Record<string, RenovateUpdateState> = {
  "approve-branch": "awaiting-approval",
  "unpend-branch": "pending-checks",
  "unlimit-branch": "rate-limited",
  "unschedule-branch": "awaiting-schedule",
  "retry-branch": "errored",
  "rebase-branch": "edited-blocked",
  "recreate-branch": "ignored",
  "unblock-branch": "ignored",
};

const MARKER_LINE_PATTERN =
  /^\s*-\s*\[([ x])\]\s*<!--\s*([a-z-]+)=(\S+?)\s*-->(.*)$/iu;

type SectionKind =
  "other" | "open" | "ignored" | "edited-blocked" | "deprecations";

function emptyCounts(): Record<RenovateUpdateState, number> {
  return {
    "awaiting-approval": 0,
    "pending-checks": 0,
    "rate-limited": 0,
    "awaiting-schedule": 0,
    errored: 0,
    "edited-blocked": 0,
    ignored: 0,
  };
}

function buildUpdate(input: {
  state: RenovateUpdateState;
  branch: string;
  rawTitle: string;
  checked: boolean;
}): RenovateUpdate {
  const title = stripOuterMarkdownLink(input.rawTitle) || input.branch;
  const { packageName, targetVersion } = extractPackageAndVersion(title);
  return {
    state: input.state,
    branch: input.branch,
    title,
    checked: input.checked,
    packageName,
    targetVersion,
    ecosystem: inferEcosystem(title, packageName),
    updateType: inferUpdateType(title, input.branch, targetVersion),
  };
}

function parseHeading(line: string): SectionKind | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
    return undefined;
  }
  const lower = trimmed.replace(/^#{2,3}\s+/u, "").toLowerCase();
  if (lower.startsWith("open")) {
    return "open";
  }
  if (lower.includes("deprecation") || lower.includes("replacement")) {
    return "deprecations";
  }
  if (lower.includes("ignored")) {
    return "ignored";
  }
  return lower.includes("edited") || lower.includes("blocked")
    ? "edited-blocked"
    : "other";
}

function syntheticBranchSlug(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 48);
  return `renovate/ignored-${slug || String(index)}`;
}

function parseMarkerLine(
  line: string,
  section: SectionKind,
): RenovateUpdate | undefined {
  const match = MARKER_LINE_PATTERN.exec(line);
  if (match === null || section === "open") {
    return undefined;
  }
  const [, box = " ", marker = "", branch = "", rest = ""] = match;
  const mapped = MARKER_STATES[marker.toLowerCase()];
  if (mapped === undefined || branch === "") {
    return undefined;
  }
  return buildUpdate({
    state: section === "ignored" ? "ignored" : mapped,
    branch,
    rawTitle: rest,
    checked: box.toLowerCase() === "x",
  });
}

function parsePlainSectionItem(
  line: string,
  section: SectionKind,
  fallbackIndex: number,
): RenovateUpdate | undefined {
  if (section !== "ignored" && section !== "edited-blocked") {
    return undefined;
  }
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("- ")) {
    return undefined;
  }
  const afterBullet = trimmed.slice(2).trimStart();
  if (afterBullet.startsWith("<!--")) {
    return undefined;
  }
  const state: RenovateUpdateState =
    section === "ignored" ? "ignored" : "edited-blocked";
  if (
    afterBullet.startsWith("[ ]") ||
    afterBullet.toLowerCase().startsWith("[x]")
  ) {
    const checked = afterBullet.slice(0, 3).toLowerCase() === "[x]";
    const rawTitle = afterBullet.slice(3).trim();
    if (rawTitle === "" || rawTitle.startsWith("<!--")) {
      return undefined;
    }
    return buildUpdate({
      state,
      branch: syntheticBranchSlug(rawTitle, fallbackIndex),
      rawTitle,
      checked,
    });
  }
  if (section === "ignored" && afterBullet !== "") {
    return buildUpdate({
      state: "ignored",
      branch: syntheticBranchSlug(afterBullet, fallbackIndex),
      rawTitle: afterBullet,
      checked: false,
    });
  }
  return undefined;
}

export function parseDependencyDashboard(body: string): DependencyDashboard {
  const lines = body.split(/\r?\n/u);
  const updates: RenovateUpdate[] = [];
  const deprecationLines: string[] = [];
  const seen = new Set<string>();
  let section: SectionKind = "other";

  for (const [idx, line] of lines.entries()) {
    const nextSection = parseHeading(line);
    if (nextSection !== undefined) {
      section = nextSection;
      continue;
    }
    if (section === "deprecations") {
      deprecationLines.push(line);
    }
    const candidate =
      parseMarkerLine(line, section) ??
      parsePlainSectionItem(line, section, idx);
    if (candidate !== undefined) {
      const key = `${candidate.state}:${candidate.branch}`;
      if (!seen.has(key)) {
        seen.add(key);
        updates.push(candidate);
      }
    }
  }

  const counts = emptyCounts();
  for (const update of updates) {
    counts[update.state] += 1;
  }

  const truncated =
    body.length >= TRUNCATED_BODY_LENGTH ||
    /section has been truncated|truncated due to|<!--\s*renovate-truncated\s*-->/iu.test(
      body,
    );

  return {
    updates,
    counts,
    deprecations: parseDeprecationRows(deprecationLines),
    lookupWarnings: parseLookupWarnings(lines),
    truncated,
  };
}

/** Whether a PR branch or author identifies a Renovate update. */
export function isRenovatePullRequest(input: {
  branch: string;
  authorLogin: string | undefined;
}): boolean {
  return (
    input.branch.startsWith("renovate/") ||
    (input.authorLogin !== undefined &&
      /^(?:app\/)?renovate(?:\[bot\])?$/u.test(input.authorLogin))
  );
}
