import {
  attentionSignals,
  findSection,
  needsMeSignals,
  type FreshSnapshot,
} from "@shepherdjerred/ops-model/assemble.ts";
import {
  SectionIdSchema,
  type Metric,
  type Section,
  type SectionId,
  type Signal,
} from "@shepherdjerred/ops-model/snapshot.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import { fetchOpsSnapshot } from "#lib/ops.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";

const TOP_ATTENTION = 5;

export type OpsSummaryOptions = {
  readonly json: boolean;
  readonly needsMe: boolean;
  readonly section: SectionId | undefined;
};

/** A bad command-line argument; printed without a stack trace. */
export class OpsUsageError extends Error {
  override readonly name = "OpsUsageError";
}

export function parseSectionId(value: string): SectionId {
  const parsed = SectionIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new OpsUsageError(
      `Unknown section "${value}". Expected one of: ${SectionIdSchema.options.join(", ")}`,
    );
  }
  return parsed.data;
}

function label(severity: Severity): string {
  return severity === "ok" ? "ok" : severity.toUpperCase();
}

function formatAge(ageMs: number): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m ago`;
}

function formatMetric(metric: Metric): string {
  const value =
    metric.value === null
      ? "n/a"
      : metric.unit === "usd"
        ? `$${metric.value.toFixed(2)}`
        : metric.unit === "ratio"
          ? `${(metric.value * 100).toFixed(0)}%`
          : `${String(metric.value)}${metric.unit === "percent" ? "%" : ""}`;
  return `${metric.label}: ${value}`;
}

function formatSignal(signal: Signal, includeSection: boolean): string[] {
  const service = signal.service === undefined ? "" : ` (${signal.service})`;
  const section = includeSection ? `${signal.section}: ` : "";
  const lines = [
    `  - [${label(signal.severity)}] ${section}${signal.title}${service}`,
  ];
  if (signal.detail !== undefined) {
    lines.push(`      ${signal.detail}`);
  }
  const [link] = signal.links;
  if (link !== undefined) {
    lines.push(`      ${link.label}: ${link.url}`);
  }
  return lines;
}

function header(snapshot: FreshSnapshot): string[] {
  const lines = [
    `Ops: ${label(snapshot.severity)} — ${snapshot.summary}`,
    `Generated ${snapshot.generatedAt} (${formatAge(snapshot.ageMs)})`,
  ];
  if (snapshot.stale) {
    lines.push(
      "WARNING: the snapshot is stale; healthy sections are shown as unknown until the collector catches up.",
    );
  }
  const failed = snapshot.sources.filter((source) => !source.ok);
  if (failed.length > 0) {
    lines.push(
      `Sources without data: ${failed.map((source) => source.source).join(", ")}`,
    );
  }
  return lines;
}

function sectionLine(section: Section, width: number): string {
  return `  ${label(section.severity).padEnd(8)} ${section.title.padEnd(width)}  ${section.summary}`;
}

function needsMeLines(snapshot: FreshSnapshot): string[] {
  const signals = needsMeSignals(snapshot);
  if (signals.length === 0) {
    return ["Needs you: nothing"];
  }
  return [
    `Needs you (${String(signals.length)}):`,
    ...signals.flatMap((signal) => formatSignal(signal, true)),
  ];
}

function sectionDetail(section: Section): string[] {
  const lines = [
    `${section.title} [${label(section.severity)}] — ${section.summary}`,
  ];
  if (section.metrics.length > 0) {
    lines.push(
      "Metrics:",
      ...section.metrics.map((metric) => `  ${formatMetric(metric)}`),
    );
  }
  lines.push(
    section.signals.length === 0
      ? "Signals: none"
      : `Signals (${String(section.signals.length)}):`,
    ...section.signals.flatMap((signal) => formatSignal(signal, false)),
  );
  return lines;
}

/** Human-readable summary. Pure, so tests pin the exact output. */
export function formatOpsSummary(
  snapshot: FreshSnapshot,
  options: Pick<OpsSummaryOptions, "needsMe" | "section">,
): string {
  const lines = header(snapshot);
  lines.push("");
  if (options.section !== undefined) {
    lines.push(...sectionDetail(findSection(snapshot, options.section)));
    return lines.join("\n");
  }
  if (options.needsMe) {
    lines.push(...needsMeLines(snapshot));
    return lines.join("\n");
  }
  const width = Math.max(
    ...snapshot.sections.map((section) => section.title.length),
  );
  lines.push(
    "Sections:",
    ...snapshot.sections.map((section) => sectionLine(section, width)),
    "",
    ...needsMeLines(snapshot),
  );
  const attention = attentionSignals(snapshot);
  if (attention.length > 0) {
    lines.push(
      "",
      `Top attention (${String(Math.min(TOP_ATTENTION, attention.length))} of ${String(attention.length)}):`,
      ...attention
        .slice(0, TOP_ATTENTION)
        .flatMap((signal) => formatSignal(signal, true)),
    );
  }
  return lines.join("\n");
}

/** The `--json` payload: the fresh snapshot, or the slice the flags select. */
export function opsSummaryJson(
  snapshot: FreshSnapshot,
  options: Pick<OpsSummaryOptions, "needsMe" | "section">,
): unknown {
  if (options.section !== undefined) {
    return findSection(snapshot, options.section);
  }
  if (options.needsMe) {
    return {
      generatedAt: snapshot.generatedAt,
      stale: snapshot.stale,
      severity: snapshot.severity,
      signals: needsMeSignals(snapshot),
    };
  }
  return snapshot;
}

export async function opsSummaryCommand(
  options: OpsSummaryOptions,
): Promise<void> {
  const config = await loadToolkitConfig();
  const snapshot = await fetchOpsSnapshot(
    await config.value("opsDashboardUrl"),
  );
  console.log(
    options.json
      ? JSON.stringify(opsSummaryJson(snapshot, options), null, 2)
      : formatOpsSummary(snapshot, options),
  );
}
