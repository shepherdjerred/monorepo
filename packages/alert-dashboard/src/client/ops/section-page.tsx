import { findSection } from "@shepherdjerred/ops-model/assemble.ts";
import type {
  Section,
  SectionId,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import type { ReactNode } from "react";

import { FlowEnrichment } from "./flow-enrichment.tsx";
import {
  PageHeading,
  RangePicker,
  SectionSummary,
  WithSnapshot,
} from "./ops-ui.tsx";
import { columnSplit } from "./panel-columns.ts";
import { SignalList, estimatedListLines } from "./signal-list.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { useRange } from "#client/charts/use-range.ts";
import type { SeriesPresetId } from "#shared/ops-schema";

export type SectionPageDefinition = {
  title: string;
  /** What the page covers, beside its title in the header. */
  meta: string;
  sections: readonly SectionId[];
  charts: readonly SeriesPresetId[];
  enrichment?: ReactNode;
};

/** One section's signals, capped like every other list. */
function SectionSignals({
  section,
  newIds,
}: {
  readonly section: Section;
  readonly newIds: ReadonlySet<string>;
}): React.JSX.Element {
  const headingId = `signals-${section.id}`;
  return (
    <section className="panel list-panel" aria-labelledby={headingId}>
      <header className="panel-heading">
        <h3 id={headingId}>
          {section.title}{" "}
          <span className="count">{section.signals.length}</span>
        </h3>
      </header>
      <SignalList
        signals={section.signals}
        empty="No signals."
        newIds={newIds}
      />
    </section>
  );
}

/** Lines a panel's heading takes, against the lines of its list. */
const PANEL_HEADING_LINES = 2;

/**
 * The signal panels in two columns that each stack on their own, so a short
 * list never leaves a gap beside a long one. The columns are cut where their
 * estimated heights come out closest; an empty section is one line.
 */
function SignalColumns({
  sections,
  newIds,
}: {
  readonly sections: readonly Section[];
  readonly newIds: ReadonlySet<string>;
}): React.JSX.Element {
  const split = columnSplit(
    sections.map(
      (section) => PANEL_HEADING_LINES + estimatedListLines(section.signals),
    ),
  );
  const columns = [sections.slice(0, split), sections.slice(split)];
  return (
    <div className="signal-columns">
      {columns.map((column) =>
        column[0] === undefined ? null : (
          <div className="stack" key={column[0].id}>
            {column.map((section) => (
              <SectionSignals
                key={section.id}
                section={section}
                newIds={newIds}
              />
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function SectionBody({
  definition,
  snapshot,
}: {
  readonly definition: SectionPageDefinition;
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const [range, setRange] = useRange("7d");
  const sections = definition.sections.map((id) => findSection(snapshot, id));
  const newIds = new Set(snapshot.newSignalIds);
  return (
    <>
      <PageHeading title={definition.title} meta={definition.meta} />
      <section className="summary-stack" aria-label="Summary">
        {sections.map((section) => (
          <SectionSummary key={section.id} section={section} />
        ))}
      </section>
      <div className="charts-heading">
        <h2 className="block-heading">Trends</h2>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="chart-grid">
        {definition.charts.map((preset) => (
          <SeriesChart key={preset} preset={preset} range={range} />
        ))}
      </div>
      {definition.enrichment}
      <h2 className="block-heading">Signals</h2>
      <SignalColumns sections={sections} newIds={newIds} />
    </>
  );
}

/**
 * A page of snapshot sections: what each one says at a glance, then the
 * Prometheus trend charts, then the signals behind the summaries. The lists
 * come last because they are the part that takes reading.
 */
function SectionPage({
  definition,
}: {
  readonly definition: SectionPageDefinition;
}): React.JSX.Element {
  return (
    <WithSnapshot title={definition.title}>
      {(snapshot) => (
        <SectionBody definition={definition} snapshot={snapshot} />
      )}
    </WithSnapshot>
  );
}

const FLOW_PAGE: SectionPageDefinition = {
  title: "Flow",
  meta: "Pull requests & work",
  sections: ["delivery", "work"],
  charts: ["prs-open", "prs-merged", "renovate-pending", "tracker-open"],
  enrichment: <FlowEnrichment />,
};

const MAINTENANCE_PAGE: SectionPageDefinition = {
  title: "Maintenance",
  meta: "What's rotting",
  sections: ["maintenance", "errors", "platform", "observability"],
  charts: ["bugsink-unresolved", "alerts-firing", "node-cpu", "node-memory"],
};

export function FlowPage(): React.JSX.Element {
  return <SectionPage definition={FLOW_PAGE} />;
}

export function MaintenancePage(): React.JSX.Element {
  return <SectionPage definition={MAINTENANCE_PAGE} />;
}
