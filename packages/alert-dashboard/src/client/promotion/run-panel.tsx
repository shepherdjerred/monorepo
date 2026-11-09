import type { PromotionRunSummary } from "@shepherdjerred/ops-model/promotion/model.ts";
import { time } from "./ui.tsx";

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

export function RunPanel({ summary }: { summary: PromotionRunSummary }) {
  const { counts } = summary;
  const groups = [
    {
      health: "error",
      title: "Needs attention",
      description: "Unresolved errors or unconfirmed actions",
      symbol: "!",
    },
    {
      health: "working",
      title: "Working",
      description: "Passed or correctly skipped",
      symbol: "✓",
    },
    {
      health: "disabled",
      title: "Disabled",
      description: "Missing setup, access or paused",
      symbol: "−",
    },
  ] as const;
  return (
    <>
      <section
        className={`p-verdict p-verdict-${summary.status}`}
        aria-labelledby="run-verdict"
      >
        <div>
          <p className="eyebrow">
            {summary.scope === "all" ? "Latest full run" : "Latest run"}
            {summary.startedAt !== null && ` · ${time(summary.startedAt)}`}
          </p>
          <h2 id="run-verdict">{verdict(summary)}</h2>
          <p className="p-run-totals">
            <strong>{counts.done}</strong> completed
            <span>·</span>
            <strong>{counts.errors}</strong> unresolved
            <span>·</span>
            <strong>
              {counts.notDue + counts.disabled + counts.notRun}
            </strong>{" "}
            not run
            {counts.running + counts.queued > 0 && (
              <>
                <span>·</span>
                <strong>{counts.running + counts.queued}</strong> in progress
              </>
            )}
          </p>
          {summary.followUpCount > 0 && (
            <p className="p-muted p-footnote">
              Includes follow-up checks and corrections; they do not count as
              additional posts.
            </p>
          )}
        </div>
      </section>
      <div className="p-health-grid" aria-label="Source health">
        {groups.map((group) => (
          <a
            className={`p-health-card p-health-${group.health}`}
            href={`#sources-${group.health}`}
            key={group.health}
          >
            <span className="p-health-symbol" aria-hidden="true">
              {group.symbol}
            </span>
            <strong>
              {summary.rows.filter((row) => row.health === group.health).length}
            </strong>
            <span>
              {group.title}
              <small>{group.description}</small>
            </span>
          </a>
        ))}
      </div>
    </>
  );
}
