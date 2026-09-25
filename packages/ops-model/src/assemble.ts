import { SNAPSHOT_STALE_AFTER_MS } from "./policy.ts";
import {
  isAttention,
  severityRank,
  worstSeverity,
  type Severity,
} from "./severity.ts";
import {
  OPS_SNAPSHOT_SCHEMA_VERSION,
  SectionSchema,
  SignalSchema,
  SnapshotSchema,
  type Metric,
  type Section,
  type SectionId,
  type Signal,
  type SignalInput,
  type Snapshot,
  type SourceId,
  type SourceStatus,
} from "./snapshot.ts";

type SectionDefinition = {
  id: SectionId;
  title: string;
  sources: readonly [SourceId, ...SourceId[]];
};

/** Which sources feed which section. Rendering order follows this list. */
export const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { id: "alerts", title: "Alerts", sources: ["alerts"] },
  {
    id: "platform",
    title: "Cluster & GitOps",
    sources: ["kubernetes", "argocd", "talos"],
  },
  {
    id: "delivery",
    title: "Delivery",
    sources: ["ci", "github", "renovate"],
  },
  { id: "work", title: "Work", sources: ["linear"] },
  { id: "errors", title: "Errors", sources: ["bugsink"] },
  { id: "product", title: "Sites & product", sources: ["probes", "posthog"] },
  { id: "ai", title: "AI usage & spend", sources: ["ai"] },
  { id: "maintenance", title: "Maintenance", sources: ["maintenance"] },
  { id: "observability", title: "Logs & traces", sources: ["logs"] },
];

export function sectionDefinition(id: SectionId): SectionDefinition {
  const definition = SECTION_DEFINITIONS.find((entry) => entry.id === id);
  if (definition === undefined) {
    throw new Error(`No section definition for ${id}`);
  }
  return definition;
}

export type AssembleInput = {
  generatedAt: Date;
  sources: readonly SourceStatus[];
  signals: readonly SignalInput[];
  metrics: readonly (Metric & { section: SectionId })[];
};

function pluralize(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function sectionSummary(
  signals: readonly Signal[],
  failedSources: readonly SourceId[],
): string {
  const attention = signals.filter((signal) => isAttention(signal.severity));
  const parts: string[] = [];
  if (attention.length > 0) {
    parts.push(pluralize(attention.length, "issue"));
  }
  const needsMe = signals.filter((signal) => signal.needsMe).length;
  if (needsMe > 0) {
    parts.push(`${String(needsMe)} waiting on you`);
  }
  if (failedSources.length > 0) {
    parts.push(`no data from ${failedSources.join(", ")}`);
  }
  return parts.length === 0 ? "All clear" : parts.join(" · ");
}

/** Signals sorted worst-first, then oldest-first. */
export function rankSignals(signals: readonly Signal[]): Signal[] {
  return signals.toSorted((left, right) => {
    const bySeverity =
      severityRank(right.severity) - severityRank(left.severity);
    return bySeverity === 0
      ? (left.since ?? "").localeCompare(right.since ?? "")
      : bySeverity;
  });
}

/**
 * Build a validated snapshot. A section containing any failed source is at
 * least `unknown`, so a blind spot never renders as healthy.
 */
export function assembleSnapshot(input: AssembleInput): Snapshot {
  const signals = input.signals.map((signal) => SignalSchema.parse(signal));
  const failed = new Set(
    input.sources.filter((status) => !status.ok).map((status) => status.source),
  );
  const reported = new Set(input.sources.map((status) => status.source));

  const sections: Section[] = SECTION_DEFINITIONS.map((definition) => {
    const sectionSignals = rankSignals(
      signals.filter((signal) => signal.section === definition.id),
    );
    const metrics = input.metrics
      .filter((metric) => metric.section === definition.id)
      .map(({ section: _section, ...metric }) => metric);
    const failedSources = definition.sources.filter(
      (source) => failed.has(source) || !reported.has(source),
    );
    const severities: Severity[] = [
      ...sectionSignals.map((signal) => signal.severity),
      ...metrics.map((metric) => metric.severity),
      ...(failedSources.length > 0 ? (["unknown"] as const) : []),
    ];
    return SectionSchema.parse({
      id: definition.id,
      title: definition.title,
      severity: worstSeverity(severities),
      summary: sectionSummary(sectionSignals, failedSources),
      sources: [...definition.sources],
      metrics,
      signals: sectionSignals,
    });
  });

  const severity = worstSeverity(sections.map((section) => section.severity));
  return SnapshotSchema.parse({
    schemaVersion: OPS_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    severity,
    summary: snapshotSummary(sections),
    sources: [...input.sources],
    sections,
  });
}

function snapshotSummary(sections: readonly Section[]): string {
  const attention = sections.filter((section) => isAttention(section.severity));
  const needsMe = sections.flatMap((section) =>
    section.signals.filter((signal) => signal.needsMe),
  ).length;
  if (needsMe === 0 && attention.length === 0) {
    return "All systems healthy";
  }
  const parts: string[] = [];
  if (attention.length > 0) {
    parts.push(
      `${pluralize(attention.length, "area")} need attention (${attention
        .map((section) => section.title)
        .join(", ")})`,
    );
  }
  if (needsMe > 0) {
    parts.push(`${String(needsMe)} waiting on you`);
  }
  return parts.join(" · ");
}

export type FreshSnapshot = Snapshot & {
  /** True when the stored snapshot is older than the staleness budget. */
  stale: boolean;
  ageMs: number;
};

/**
 * Apply the freshness policy to a stored snapshot at read time. A stale
 * snapshot degrades every healthy section to `unknown`; it never stays green.
 */
export function applyFreshness(
  snapshot: Snapshot,
  now: Date,
  staleAfterMs: number = SNAPSHOT_STALE_AFTER_MS,
): FreshSnapshot {
  const ageMs = now.getTime() - Date.parse(snapshot.generatedAt);
  const stale = ageMs > staleAfterMs;
  if (!stale) {
    return { ...snapshot, stale, ageMs };
  }
  const minutes = Math.round(ageMs / 60_000);
  const sections = snapshot.sections.map((section) => ({
    ...section,
    severity: worstSeverity([section.severity, "unknown"]),
  }));
  return {
    ...snapshot,
    sections,
    severity: worstSeverity([snapshot.severity, "unknown"]),
    summary: `Snapshot is ${String(minutes)} minutes old · ${snapshot.summary}`,
    stale,
    ageMs,
  };
}

export function allSignals(snapshot: Snapshot): Signal[] {
  return rankSignals(snapshot.sections.flatMap((section) => section.signals));
}

/** Signals that deserve attention, worst-first. */
export function attentionSignals(snapshot: Snapshot): Signal[] {
  return allSignals(snapshot).filter((signal) => isAttention(signal.severity));
}

/** Signals whose next action belongs to Jerred, worst-first. */
export function needsMeSignals(snapshot: Snapshot): Signal[] {
  return allSignals(snapshot).filter((signal) => signal.needsMe);
}

/** Signals absent from a previously seen set of signal ids. */
export function newSignals(
  snapshot: Snapshot,
  seenIds: ReadonlySet<string>,
): Signal[] {
  return allSignals(snapshot).filter((signal) => !seenIds.has(signal.id));
}

export function findSection(snapshot: Snapshot, id: SectionId): Section {
  const section = snapshot.sections.find((entry) => entry.id === id);
  if (section === undefined) {
    throw new Error(`Snapshot has no ${id} section`);
  }
  return section;
}

/** A metric the caller requires; absence is a broken contract. */
export function requireMetric(section: Section, id: string): Metric {
  const metric = section.metrics.find((entry) => entry.id === id);
  if (metric === undefined) {
    throw new Error(`Section ${section.id} has no metric ${id}`);
  }
  return metric;
}

/** A metric that may be absent because its source failed this round. */
export function findMetric(section: Section, id: string): Metric | undefined {
  return section.metrics.find((entry) => entry.id === id);
}
