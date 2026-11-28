import {
  Button,
  DataTable,
  FilterBar,
  Meter,
  Section,
  Sparkline,
  StackedMeter,
  StatusGlyph,
  StatusMatrix,
  Tabs,
  Timeline,
  filtersActive,
  groupBySeverity,
  type DataTableColumn,
} from "@shepherdjerred/console-ui";
import { useMemo, useState } from "react";

import {
  KIT_NOW,
  KIT_STEPS,
  KIT_TIMELINE,
  kitSignals,
  minutesText,
  type KitSignal,
} from "./kit-data-rows.ts";
import "./kit-data.css";

type Scope = "all" | "firing" | "silenced";

const SIGNALS = kitSignals();
const FIRING = SIGNALS.filter((signal) => signal.firingMinutes !== null);
const SILENCED = SIGNALS.filter((signal) => signal.silenced);

const SCOPE_ROWS: Readonly<Record<Scope, readonly KitSignal[]>> = {
  all: SIGNALS,
  firing: FIRING,
  silenced: SILENCED,
};

const SCOPES = [
  { value: "all", label: "All", count: SIGNALS.length },
  { value: "firing", label: "Firing", count: FIRING.length },
  { value: "silenced", label: "Silenced", count: SILENCED.length },
] as const;

const BY_SEVERITY = groupBySeverity((signal: KitSignal) => signal.severity);

const COLUMNS: readonly DataTableColumn<KitSignal>[] = [
  {
    key: "name",
    header: "Signal",
    render: (signal) => signal.name,
    sortValue: (signal) => signal.name,
  },
  {
    key: "status",
    header: "Status",
    render: (signal) => (
      <StatusGlyph severity={signal.severity} label={signal.status} />
    ),
    exportValue: (signal) => signal.status,
  },
  {
    key: "service",
    header: "Service",
    fill: true,
    render: (signal) => signal.service,
    sortValue: (signal) => signal.service,
  },
  {
    key: "trend",
    header: "Last hour",
    render: (signal) => (
      <Sparkline values={signal.trend} severity={signal.severity} />
    ),
    exportValue: (signal) => signal.trend.join(" "),
  },
  {
    key: "budget",
    header: "Budget",
    render: (signal) => (
      <Meter
        value={signal.budget}
        severity={signal.severity}
        label={`${signal.name} error budget`}
      />
    ),
    sortValue: (signal) => signal.budget,
  },
  {
    key: "firing",
    header: "Firing for",
    align: "right",
    render: (signal) => minutesText(signal.firingMinutes),
    sortValue: (signal) => signal.firingMinutes,
  },
  {
    key: "count",
    header: "Count",
    align: "right",
    render: (signal) =>
      signal.count === 0 ? <span className="ui-zero">0</span> : signal.count,
    sortValue: (signal) => signal.count,
  },
];

function signalKey(signal: KitSignal): string {
  return signal.id;
}

function signalLabel(signal: KitSignal): string {
  return `${signal.name} on ${signal.service}`;
}

function SignalDetail({
  signal,
}: {
  readonly signal: KitSignal;
}): React.JSX.Element {
  return (
    <div className="kit-data-detail">
      <p>
        {`${signal.name} watches ${signal.service}. It has fired ${String(signal.count)} times this week.`}
      </p>
      <Timeline
        label={`${signal.name} history`}
        items={KIT_TIMELINE.slice(0, 2)}
        density="compact"
        now={KIT_NOW}
      />
    </div>
  );
}

function SignalsTable(): React.JSX.Element {
  const [scope, setScope] = useState<Scope>("all");
  const [selected, setSelected] = useState<readonly string[]>([]);
  return (
    <Section
      id="data-table"
      title="Signals"
      count={`${String(SIGNALS.length)} generated`}
    >
      <DataTable
        caption="Signals by severity, worst first. Past 200 rows only those in view render."
        hideCaption
        rows={SCOPE_ROWS[scope]}
        totalCount={SIGNALS.length}
        countNoun={{ one: "signal", other: "signals" }}
        rowKey={signalKey}
        rowLabel={signalLabel}
        columns={COLUMNS}
        defaultSort={{ key: "firing", direction: "descending" }}
        searchText={(signal) => `${signal.name} ${signal.service}`}
        searchPlaceholder="Filter signals…"
        filters={[
          {
            key: "scope",
            label: "Show",
            options: SCOPES,
            value: scope,
            onChange: (value) => {
              setScope(
                value === "firing" || value === "silenced" ? value : "all",
              );
            },
          },
        ]}
        exportFilename="signals"
        groupBy={BY_SEVERITY}
        selectable
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={() => (
          <>
            <Button>Acknowledge</Button>
            <Button>Silence…</Button>
          </>
        )}
        renderExpanded={(signal) => <SignalDetail signal={signal} />}
        virtualize
        keyboardNavigation
      />
    </Section>
  );
}

const SPARK_ROWS = SIGNALS.slice(0, 5);

function SparklineTable(): React.JSX.Element {
  return (
    <Section title="Sparklines in a table" headingLevel={3}>
      <DataTable
        caption="Request rate per service, last hour"
        hideCaption
        rows={SPARK_ROWS}
        rowKey={signalKey}
        columns={[
          {
            key: "service",
            header: "Service",
            render: (signal) => signal.service,
          },
          {
            key: "trend",
            header: "Last hour",
            render: (signal) => (
              <Sparkline values={signal.trend} severity={signal.severity} />
            ),
          },
          {
            key: "now",
            header: "Now",
            align: "right",
            render: (signal) => `${String(signal.trend.at(-1) ?? 0)}/s`,
            sortValue: (signal) => signal.trend.at(-1),
          },
        ]}
      />
    </Section>
  );
}

function StandaloneFilterBar(): React.JSX.Element {
  const [query, setQuery] = useState("lag");
  const [scope, setScope] = useState<Scope>("firing");
  const shown = useMemo(
    () =>
      SCOPE_ROWS[scope].filter((signal) =>
        signal.name.toLowerCase().includes(query.trim().toLowerCase()),
      ).length,
    [query, scope],
  );
  return (
    <Section title="Filter bar" headingLevel={3}>
      <FilterBar
        search={{
          value: query,
          onChange: setQuery,
          label: "Filter signals",
          placeholder: "Filter signals…",
        }}
        filters={
          <Tabs
            label="Show"
            options={SCOPES}
            value={scope}
            onChange={setScope}
          />
        }
        count={{
          shown,
          total: SIGNALS.length,
          noun: { one: "signal", other: "signals" },
        }}
        active={filtersActive({
          search: query,
          filters: [{ value: scope, defaultValue: "all" }],
        })}
        onClear={() => {
          setQuery("");
          setScope("all");
        }}
        end={<Button>Export</Button>}
      />
    </Section>
  );
}

const MATRIX_COLUMNS = [
  { key: "snapshot", label: "Snapshot" },
  { key: "offsite", label: "Offsite" },
  { key: "restore", label: "Restore drill" },
  { key: "audit", label: "Audit" },
] as const;

function Matrix(): React.JSX.Element {
  return (
    <Section title="Status matrix" headingLevel={3}>
      <StatusMatrix
        caption="Backup verification by dataset"
        hideCaption
        rowHeaderLabel="Dataset"
        columns={MATRIX_COLUMNS}
        rows={[
          {
            key: "postgres",
            label: "PostgreSQL",
            meta: "daily 02:00",
            cells: {
              snapshot: { status: "ok", label: "2h ago" },
              offsite: {
                status: "warning",
                label: "29h ago",
                detail: "SLA 24h",
              },
              restore: { status: "ok", label: "Passed" },
              audit: { status: "info", label: "Pinned" },
            },
          },
          {
            key: "seaweedfs",
            label: "SeaweedFS",
            meta: "hourly",
            cells: {
              snapshot: { status: "ok", label: "14m ago" },
              offsite: { status: "ok", label: "3h ago" },
              restore: { status: "error", label: "Failed", detail: "checksum" },
            },
          },
          {
            key: "tracker",
            label: "Tracker",
            meta: "daily 03:00",
            cells: {
              snapshot: { status: "ok", label: "5h ago" },
              offsite: { status: "ok", label: "5h ago" },
              restore: { status: "unknown", label: "Not run" },
              audit: { status: "ok", label: "OK" },
            },
          },
        ]}
      />
    </Section>
  );
}

const usd = (value: number): string => `$${value.toFixed(2)}`;
const gib = (value: number): string => `${value.toFixed(1)} GiB`;

function Meters(): React.JSX.Element {
  return (
    <Section title="Meters" headingLevel={3}>
      <div className="ui-section-body kit-data-meters">
        <Meter
          block
          label="Monthly API spend"
          value={86.4}
          max={150}
          format={usd}
          projected={162}
          detail="Projected above the monthly cap by $12.00"
        />
        <Meter
          block
          label="Backups volume"
          value={412}
          max={500}
          format={(value) => `${String(value)} GiB`}
        />
        <StackedMeter
          block
          label="Cluster storage"
          format={gib}
          segments={[
            { key: "db", label: "Databases", value: 182.4 },
            { key: "media", label: "Media", value: 96.1 },
            { key: "logs", label: "Logs", value: 41.7 },
            { key: "free", label: "Other", value: 12.3, severity: "unknown" },
          ]}
        />
        <div className="kit-data-inline">
          <Meter value={34} label="Disk used" />
          <Meter value={88} label="Memory used" />
          <Meter value={null} label="GPU used" />
          <StackedMeter
            label="Pods by phase"
            segments={[
              { key: "run", label: "Running", value: 75, severity: "ok" },
              { key: "pend", label: "Pending", value: 15, severity: "warning" },
              { key: "fail", label: "Failed", value: 10, severity: "error" },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

/** The data pieces: DataTable, FilterBar, Timeline, charts and meters. */
export function KitData(): React.JSX.Element {
  return (
    <>
      <SignalsTable />
      <StandaloneFilterBar />
      <div className="ui-columns">
        <Section title="Activity" headingLevel={3}>
          <Timeline
            label="Activity"
            items={KIT_TIMELINE}
            groupByDay
            now={KIT_NOW}
            dayHeadingLevel={4}
          />
        </Section>
        <Section title="Deployment steps" headingLevel={3}>
          <Timeline
            label="Deployment steps"
            items={KIT_STEPS}
            density="compact"
          />
        </Section>
      </div>
      <div className="ui-columns">
        <SparklineTable />
        <Matrix />
      </div>
      <Meters />
    </>
  );
}
