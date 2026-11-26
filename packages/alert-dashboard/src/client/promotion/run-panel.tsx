import {
  FigureStrip,
  StatusGlyph,
  type Severity,
} from "@shepherdjerred/console-ui";
import type {
  PromotionOverview,
  PromotionRunSummary,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { spendFigures } from "./spend-summary.tsx";
import { time } from "./ui.tsx";

const VERDICT_SEVERITY = {
  passed: "ok",
  attention: "error",
  running: "info",
  interrupted: "warning",
  not_run: "unknown",
} as const satisfies Record<PromotionRunSummary["status"], Severity>;

function verdict(summary: PromotionRunSummary) {
  return summary.status === "running"
    ? "Run in progress"
    : summary.status === "not_run"
      ? "No run recorded yet"
      : summary.status === "interrupted"
        ? "Run interrupted"
        : summary.status === "attention"
          ? "Needs attention"
          : summary.counts.done === 0
            ? "Nothing needed to run"
            : "Everything due passed";
}

export function RunPanel({
  summary,
  spend,
}: {
  summary: PromotionRunSummary;
  spend: PromotionOverview["spend"];
}) {
  const { counts } = summary;
  const inProgress = counts.running + counts.queued;
  const sources = (health: PromotionRunSummary["rows"][number]["health"]) =>
    summary.rows.filter((row) => row.health === health).length;
  const attention = sources("error");
  const disabled = sources("disabled");
  const groups: {
    health: string;
    title: string;
    description: string;
    count: number;
    severity: Severity;
  }[] = [
    {
      health: "error",
      title: "Needs attention",
      description: "Unresolved errors or unconfirmed actions",
      count: attention,
      severity: attention > 0 ? "error" : "ok",
    },
    {
      health: "working",
      title: "Working",
      description: "Passed or correctly skipped",
      count: sources("working"),
      severity: "ok",
    },
    {
      health: "disabled",
      title: "Disabled",
      description: "Missing setup, access or paused",
      count: disabled,
      severity: "unknown",
    },
  ];
  return (
    <section className="p-section p-run" aria-labelledby="run-verdict">
      <header className="ui-section-head">
        <h2 id="run-verdict" className="ui-section-title">
          <StatusGlyph
            severity={VERDICT_SEVERITY[summary.status]}
            label={verdict(summary)}
          />
        </h2>
        <span className="p-run-when">
          {summary.scope === "all" ? "Latest full run" : "Latest run"}
          {summary.startedAt !== null && ` · ${time(summary.startedAt)}`}
        </span>
      </header>
      <FigureStrip
        figures={[
          { label: "Completed", value: counts.done },
          {
            label: "Unresolved",
            value: counts.errors,
            ...(counts.errors > 0 ? { severity: "error" as const } : {}),
          },
          {
            label: "Not run",
            value: counts.notDue + counts.disabled + counts.notRun,
          },
          ...(inProgress > 0
            ? [{ label: "In progress", value: inProgress }]
            : []),
          ...spendFigures(spend),
        ]}
      />
      {summary.followUpCount > 0 && (
        <p className="p-muted p-footnote">
          Includes follow-up checks and corrections; they do not count as
          additional posts.
        </p>
      )}
      <ul className="glance-strip p-health" aria-label="Source health">
        {groups.map((group) => (
          <li
            className="glance-cell"
            data-sev={group.severity}
            key={group.health}
          >
            <a href={`#sources-${group.health}`}>
              <span className="ui-strip-label">
                <StatusGlyph severity={group.severity} label={group.title} />
              </span>
              <span className="ui-strip-value">
                <span className="ui-strip-figure">{group.count}</span>
              </span>
              <span className="ui-strip-hint">{group.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
