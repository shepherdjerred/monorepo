import {
  Banner,
  Button,
  Chip,
  FigureStrip,
  HeaderBar,
  ICONS,
  Meter,
  SearchField,
  Section,
  State,
  StatusGlyph,
  Tabs,
  useSearchShortcut,
} from "@shepherdjerred/console-ui";
import { Fragment, useRef, useState } from "react";
import { Link } from "react-router";

import { KitDetailForms } from "./kit-detail-forms.tsx";
import { KitControls } from "./kit-controls.tsx";
import { KitData } from "./kit-data.tsx";
import { KitOverlays } from "./kit-overlays.tsx";
import {
  KIT_GROUPS,
  KitDisabledTabs,
  KitTabs,
  type KitAlert,
} from "./kit-parts.tsx";
import "./kit.css";

type Scope = "all" | "firing" | "silenced";

const SCOPES = [
  { value: "all", label: "All", count: 5 },
  { value: "firing", label: "Firing", count: 4 },
  { value: "silenced", label: "Silenced", count: 1 },
] as const;

function AlertRow({
  alert,
  current,
}: {
  readonly alert: KitAlert;
  readonly current: boolean;
}): React.JSX.Element {
  return (
    <tr data-current={current ? "" : undefined}>
      <th scope="row" className="ui-lead">
        <Link className="ui-row-link" to="/kit/detail">
          {alert.name}
        </Link>
      </th>
      <td data-label="Status">
        <StatusGlyph severity={alert.severity} label={alert.status} />
      </td>
      <td data-label="Service" className="ui-fill">
        <span className="ui-truncate">{alert.service}</span>
      </td>
      <td data-label="Labels">
        <span className="ui-chips">
          {alert.labels.map((label) => (
            <Chip key={label}>{label}</Chip>
          ))}
        </span>
      </td>
      <td data-label="Budget">
        <Meter
          value={alert.budget}
          severity={alert.severity}
          label={`${alert.name} error budget`}
        />
      </td>
      <td data-label="Firing for" className="ui-num">
        {alert.firing}
      </td>
      <td data-label="Count" className="ui-num">
        {alert.count === 0 ? <span className="ui-zero">0</span> : alert.count}
      </td>
    </tr>
  );
}

function AlertTable(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const Expand = ICONS.expand;
  const Collapse = ICONS.collapse;
  return (
    <div className="ui-table-scroll">
      <table className="ui-table" data-stack="">
        <caption className="ui-sr-only">
          Alerts by area, worst first. Rows stack into lines on a phone.
        </caption>
        <thead>
          <tr>
            <th scope="col">Alert</th>
            <th scope="col">Status</th>
            <th scope="col">Service</th>
            <th scope="col">Labels</th>
            <th scope="col">Budget</th>
            <th scope="col" className="ui-num">
              Firing for
            </th>
            <th scope="col" className="ui-num">
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          {KIT_GROUPS.map((group, groupIndex) => {
            const open = !collapsed.has(group.name);
            const Twist = open ? Collapse : Expand;
            return (
              <Fragment key={group.name}>
                <tr className="ui-table-group">
                  <th scope="colgroup" colSpan={7}>
                    <button
                      type="button"
                      className="ui-twist"
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${group.name}`}
                      onClick={() => {
                        const next = new Set(collapsed);
                        if (open) next.add(group.name);
                        else next.delete(group.name);
                        setCollapsed(next);
                      }}
                    >
                      <Twist aria-hidden="true" />
                    </button>
                    {group.name}
                    <span className="ui-count">{group.alerts.length}</span>
                  </th>
                </tr>
                {open
                  ? group.alerts.map((alert, index) => (
                      <AlertRow
                        key={alert.name}
                        alert={alert}
                        current={groupIndex === 0 && index === 1}
                      />
                    ))
                  : null}
                {open && groupIndex === 0 ? (
                  <tr className="ui-table-child">
                    <th scope="row">↳ worker-7c9 restarts</th>
                    <td data-label="Status">
                      <StatusGlyph
                        severity="info"
                        icon={ICONS.refresh}
                        label="Restarting"
                      />
                    </td>
                    <td data-label="Service" className="ui-fill">
                      <span className="ui-truncate">temporal-worker</span>
                    </td>
                    <td data-label="Labels">
                      <Chip label="exit" value={137} severity="error" />
                    </td>
                    <td data-label="Budget">
                      <span className="ui-muted">—</span>
                    </td>
                    <td data-label="Firing for" className="ui-num">
                      4m
                    </td>
                    <td data-label="Count" className="ui-num">
                      12
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTable(): React.JSX.Element {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            <th scope="col">Silence</th>
            <th scope="col">Matchers</th>
            <th scope="col" className="ui-num">
              Ends
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="ui-table-empty">
            <td colSpan={3}>No silences. New silences appear here.</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function WrapTable(): React.JSX.Element {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            <th scope="col">Failure</th>
            <th scope="col" className="ui-num">
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-wrap="">
              Wrapping cell: a long headline or error message breaks onto
              further lines instead of stretching the row, as in this
              connection-refused example from the mail relay.
            </td>
            <td className="ui-num">3</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * `/kit`: every console-ui piece in a realistic list page. Reached from the
 * command palette, not the sidebar.
 */
export function KitPage(): React.JSX.Element {
  const [scope, setScope] = useState<Scope>("all");
  const search = useRef<HTMLInputElement>(null);
  useSearchShortcut(search);
  const Refresh = ICONS.refresh;
  const Add = ICONS.add;
  return (
    <main className="kit-page">
      <HeaderBar
        title="Console kit"
        tabs={<KitTabs />}
        meta="Built only from @shepherdjerred/console-ui"
        actions={
          <>
            <Button>
              <Refresh aria-hidden="true" />
              Refresh
            </Button>
            <Button variant="primary">
              <Add aria-hidden="true" />
              New silence
            </Button>
          </>
        }
      />
      <Banner severity="warning" label="Stale" actions={<Button>Retry</Button>}>
        The snapshot is 12 minutes old; the collector last answered at 14:02.
      </Banner>
      <FigureStrip
        label="Alert summary"
        figures={[
          { label: "Firing", value: 4, hint: "in 2 areas", href: "#alerts" },
          { label: "Critical", value: 1, severity: "error" },
          { label: "Warnings", value: 2, severity: "warning" },
          { label: "No data", value: 1, severity: "unknown" },
          { label: "Healthy services", value: 142, severity: "ok" },
        ]}
      />
      <Section
        id="alerts"
        title="Alerts"
        count="5 of 143"
        actions={<Button>Acknowledge all</Button>}
        footer={
          <>
            Showing 5 of 143
            <Button>Show all</Button>
          </>
        }
      >
        <div className="ui-toolbar">
          <SearchField
            ref={search}
            label="Filter alerts"
            placeholder="Filter alerts…"
          />
          <Tabs
            label="Show"
            value={scope}
            onChange={setScope}
            options={SCOPES}
          />
          <span className="ui-toolbar-end ui-muted">Sorted by severity</span>
        </div>
        <AlertTable />
      </Section>
      <Section title="Silences" count={0}>
        <EmptyTable />
      </Section>
      <Section title="Disabled tab" headingLevel={3}>
        <KitDisabledTabs />
      </Section>
      <Section title="Wrapping cells" headingLevel={3}>
        <WrapTable />
      </Section>
      <div className="ui-columns">
        <Section title="Banners" headingLevel={3}>
          <Banner severity="error" actions={<Button>Retry</Button>}>
            Alertmanager did not answer: connection refused.
          </Banner>
          <Banner severity="info">A deploy of hub is rolling out.</Banner>
          <Banner severity="ok" label="Resolved">
            All 12 alerts in cluster resolved.
          </Banner>
          <Banner severity="unknown" label="No data">
            Velero has not reported since Tuesday.
          </Banner>
        </Section>
        <Section title="States" headingLevel={3}>
          <State kind="loading">Loading alerts…</State>
          <State kind="empty" action={<Button>Clear filters</Button>}>
            No alerts match these filters.
          </State>
          <State kind="error" action={<Button>Retry</Button>}>
            Could not load alerts: HTTP 502.
          </State>
        </Section>
      </div>
      <KitControls />
      <KitDetailForms />
      <KitData />
      <KitOverlays />
    </main>
  );
}
