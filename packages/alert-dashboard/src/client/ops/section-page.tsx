import { findSection } from "@shepherdjerred/ops-model/assemble.ts";
import type {
  SectionId,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";

import {
  MetricTile,
  PageHeading,
  RangePicker,
  SeverityBadge,
  SignalList,
  WithSnapshot,
} from "./ops-ui.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { useRange } from "#client/charts/use-range.ts";
import type { SeriesPresetId } from "#shared/ops-schema";

export type SectionPageDefinition = {
  title: string;
  eyebrow: string;
  sections: readonly SectionId[];
  charts: readonly SeriesPresetId[];
};

function SectionBlock({
  snapshot,
  id,
}: {
  readonly snapshot: SnapshotResponse;
  readonly id: SectionId;
}): React.JSX.Element {
  const section = findSection(snapshot, id);
  const newIds = new Set(snapshot.newSignalIds);
  return (
    <section className="panel list-panel" aria-labelledby={`section-${id}`}>
      <header className="panel-heading">
        <h2 id={`section-${id}`}>{section.title}</h2>
        <SeverityBadge severity={section.severity} />
      </header>
      <p className="panel-summary">{section.summary}</p>
      {section.metrics.length === 0 ? null : (
        <div className="metric-row">
          {section.metrics.map((metric) => (
            <MetricTile key={metric.id} metric={metric} />
          ))}
        </div>
      )}
      <SignalList
        signals={section.signals}
        empty="No signals."
        newIds={newIds}
      />
    </section>
  );
}

/** A page of snapshot sections followed by Prometheus trend charts. */
function SectionPage({
  definition,
}: {
  readonly definition: SectionPageDefinition;
}): React.JSX.Element {
  const [range, setRange] = useRange("7d");
  return (
    <WithSnapshot title={definition.title}>
      {(snapshot) => (
        <>
          <PageHeading eyebrow={definition.eyebrow} title={definition.title} />
          <div className="section-columns">
            {definition.sections.map((id) => (
              <SectionBlock key={id} snapshot={snapshot} id={id} />
            ))}
          </div>
          <div className="charts-heading">
            <h2 className="block-heading">Trends</h2>
            <RangePicker value={range} onChange={setRange} />
          </div>
          <div className="chart-grid">
            {definition.charts.map((preset) => (
              <SeriesChart key={preset} preset={preset} range={range} />
            ))}
          </div>
        </>
      )}
    </WithSnapshot>
  );
}

const DELIVERY_PAGE: SectionPageDefinition = {
  title: "Delivery",
  eyebrow: "Flow",
  sections: ["delivery", "work"],
  charts: ["prs-open", "prs-merged", "renovate-pending", "linear-open"],
};

const MAINTENANCE_PAGE: SectionPageDefinition = {
  title: "Maintenance",
  eyebrow: "What's rotting",
  sections: ["maintenance", "errors", "platform", "observability"],
  charts: ["bugsink-unresolved", "alerts-firing", "node-cpu", "node-memory"],
};

export function DeliveryPage(): React.JSX.Element {
  return <SectionPage definition={DELIVERY_PAGE} />;
}

export function MaintenancePage(): React.JSX.Element {
  return <SectionPage definition={MAINTENANCE_PAGE} />;
}
