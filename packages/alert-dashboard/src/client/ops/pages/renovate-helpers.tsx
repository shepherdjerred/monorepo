import {
  RENOVATE_IMPACT_LEVELS,
  type RenovateDeprecation,
  type RenovateImpactLevel,
  type RenovateItem,
  type RenovateRecentMerged,
} from "@shepherdjerred/ops-model/facets.ts";
import { TOOL_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { age } from "#client/time.ts";
import type { DataTableColumn } from "#client/visuals/index.ts";
import { pillSeverity, type PillTone } from "#client/visuals/pill.ts";
import { Identifier } from "#client/visuals/identifier.tsx";

export const UPDATE_TYPES = [
  "major",
  "minor",
  "patch",
  "digest",
  "pin",
  "unknown",
] as const;
export const TYPE_COLOR: Record<string, string> = {
  major: "var(--ui-sev-error)",
  minor: "var(--ui-sev-warning)",
  patch: "var(--ui-sev-ok)",
  digest: "var(--ui-sev-info)",
  pin: "var(--ui-accent)",
};
const IMPACT_META: Record<
  RenovateImpactLevel,
  {
    readonly g: string;
    readonly label: string;
    readonly tone: PillTone;
    readonly rank: number;
  }
> = {
  breaking: { g: "✕", label: "Breaking", tone: "error", rank: 4 },
  high: { g: "▲", label: "High", tone: "warning", rank: 3 },
  medium: { g: "◆", label: "Medium", tone: "info", rank: 2 },
  low: { g: "•", label: "Low", tone: "info", rank: 1 },
  none: { g: "✓", label: "None", tone: "ok", rank: 0 },
};
export const IMPACT_OPTIONS = [
  { value: "all", label: "All impacts" },
  ...[...RENOVATE_IMPACT_LEVELS]
    .reverse()
    .map((lvl) => ({ value: lvl, label: IMPACT_META[lvl].label })),
];
export const TYPE_OPTIONS = [
  "all",
  "major",
  "minor",
  "patch",
  "digest",
  "pin",
].map((v) => ({
  value: v,
  label: v === "all" ? "All types" : v.charAt(0).toUpperCase() + v.slice(1),
}));

export function ver(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw.length === 0) {
    return "?";
  }
  return raw.startsWith("v") || raw.startsWith("sha256:") ? raw : `v${raw}`;
}

export function versions(i: RenovateItem): {
  readonly running: string | null;
  readonly pinned: string | null;
  readonly target: string | null;
  readonly drifted: boolean;
} {
  const running = i.delta?.runningVersion ?? i.runningVersion ?? null;
  const pinned = i.delta?.pinnedVersion ?? i.pinnedVersion ?? null;
  const target = i.delta?.targetVersion ?? i.targetVersion ?? null;
  return {
    running,
    pinned,
    target,
    drifted: running !== null && pinned !== null && running !== pinned,
  };
}

function col<T>(
  key: string,
  header: string,
  render: (row: T) => ReactNode,
  sortValue?: (row: T) => string | number | null | undefined,
): DataTableColumn<T> {
  return { key, header, render, sortValue };
}

function Pill(p: {
  readonly tone: PillTone;
  readonly g?: string;
  readonly text: string;
}): React.JSX.Element {
  return (
    <span className="visual-pill" data-sev={pillSeverity(p.tone)}>
      {p.g === undefined ? null : <span aria-hidden="true">{p.g}</span>}
      {p.text}
    </span>
  );
}

export function ExtLink(p: {
  readonly href: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <a className="eng-ext-link" href={p.href} target="_blank" rel="noreferrer">
      {p.children}
      <ExternalLinkIcon aria-hidden="true" />
    </a>
  );
}

export function buildUpdateColumns(
  issueNum: number | null,
  issueUrl: string | undefined,
): DataTableColumn<RenovateItem>[] {
  const issueHref =
    issueUrl ??
    (issueNum === null
      ? undefined
      : `${TOOL_HOSTS.github}/issues/${String(issueNum)}`);
  return [
    col(
      "package",
      "Package & ecosystem",
      (i) => (
        <div className="eng-pkg-cell">
          <span className="eng-pkg-name">
            <Identifier value={i.packageName} />
          </span>
          <span className="eng-pkg-sub">
            <Pill tone="neutral" text={i.ecosystem} />
            <Pill tone="info" text={i.updateType} />
          </span>
        </div>
      ),
      (i) => i.packageName,
    ),
    col(
      "versionDelta",
      "Version delta",
      (i) => {
        const { running, pinned, target, drifted } = versions(i);
        return (
          <div className="eng-version-cell">
            <span className="eng-version-arrow">{`Running ${ver(running ?? pinned)} → ${ver(target)}`}</span>
            {drifted ? (
              <Pill
                tone="warning"
                g="!"
                text={`Pinned ${ver(pinned)} ≠ Running ${ver(running)}`}
              />
            ) : null}
          </div>
        );
      },
      (i) => i.delta?.versionsBehindCount ?? null,
    ),
    col(
      "impact",
      "Impact",
      (i) => {
        const m = IMPACT_META[i.delta?.impactLevel ?? "none"];
        return <Pill tone={m.tone} g={m.g} text={m.label} />;
      },
      (i) =>
        i.delta === undefined ? -1 : IMPACT_META[i.delta.impactLevel].rank,
    ),
    col(
      "summary",
      "LLM summary",
      (i) => (
        <p className="eng-summary-clamp">
          {i.delta?.summary ?? "Pending enrichment"}
        </p>
      ),
      (i) => i.delta?.summary ?? null,
    ),
    col(
      "state",
      "State / CI",
      (i) => (
        <div className="eng-pill-row">
          <Pill tone="neutral" text={i.state} />
          {i.checks === undefined ? null : (
            <Pill
              tone={
                i.checks === "SUCCESS"
                  ? "ok"
                  : i.checks === "FAILURE"
                    ? "error"
                    : "warning"
              }
              g={
                i.checks === "SUCCESS"
                  ? "✓"
                  : i.checks === "FAILURE"
                    ? "✕"
                    : "•"
              }
              text={i.checks}
            />
          )}
          {i.exactHeadApproved === true ? (
            <Pill tone="ok" g="✓" text="Approved" />
          ) : null}
          {i.halfUpgrade === true ? (
            <Pill tone="warning" g="!" text="Half-upgrade" />
          ) : null}
        </div>
      ),
      (i) => i.state,
    ),
    col(
      "links",
      "Links",
      (i) => (
        <div className="eng-pill-row">
          {i.prNumber === undefined ? null : (
            <ExtLink
              href={
                i.prUrl ?? `${TOOL_HOSTS.github}/pull/${String(i.prNumber)}`
              }
            >
              {`#${String(i.prNumber)}`}
              <span className="sr-only">{` PR for ${i.packageName}`}</span>
            </ExtLink>
          )}
          {issueHref === undefined || issueNum === null ? null : (
            <ExtLink href={issueHref}>
              {`#${String(issueNum)}`}
              <span className="sr-only">{` dashboard issue for ${i.packageName}`}</span>
            </ExtLink>
          )}
        </div>
      ),
      (i) => i.prNumber ?? null,
    ),
  ];
}

export const DEPRECATION_COLUMNS: readonly DataTableColumn<RenovateDeprecation>[] =
  [
    col(
      "current",
      "Deprecated package",
      (d) => <code>{d.current}</code>,
      (d) => d.current,
    ),
    col(
      "replacement",
      "Replacement",
      (d) => (d.replacement === null ? "None" : <code>{d.replacement}</code>),
      (d) => d.replacement,
    ),
    col("notes", "Notes", (d) => d.notes ?? "—"),
  ];

export const MERGED_COLUMNS: readonly DataTableColumn<RenovateRecentMerged>[] =
  [
    col(
      "number",
      "PR",
      (r) => <ExtLink href={r.url}>{`#${String(r.number)}`}</ExtLink>,
      (r) => r.number,
    ),
    col(
      "title",
      "Title",
      (r) => r.title,
      (r) => r.title,
    ),
    col(
      "branch",
      "Branch",
      (r) =>
        r.branch === undefined ? (
          "—"
        ) : (
          <code className="visual-branch-chip">{r.branch}</code>
        ),
      (r) => r.branch ?? null,
    ),
    {
      ...col(
        "mergedAt",
        "Merged",
        (r) => <time dateTime={r.mergedAt}>{age(r.mergedAt)}</time>,
        (r) => r.mergedAt,
      ),
      align: "right",
    },
  ];
