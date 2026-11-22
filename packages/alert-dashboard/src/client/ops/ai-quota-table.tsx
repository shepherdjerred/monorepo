import { Temporal } from "@js-temporal/polyfill";
import { StatusGlyph } from "@shepherdjerred/console-ui";
import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";

import {
  quotaTable,
  resetsText,
  usedText,
  type QuotaGroup,
  type QuotaRow,
  type QuotaTableModel,
} from "./ai-quota.ts";
import { formatInstant } from "#client/time.ts";

const COLUMN_COUNT = 4;

/**
 * The usage as console-ui's inline meter, with the severity's glyph and word
 * after it when it needs attention. A window that has reset keeps its last
 * reading as the meter's value, drawn hatched and grey so it never reads as a
 * live full bar.
 */
function UsedCell({ row }: { readonly row: QuotaRow }): React.JSX.Element {
  const percent = Math.min(row.usedRatio, 1) * 100;
  const text = usedText(row);
  return (
    <td className="quota-used" role="cell">
      <div className="quota-meter">
        <span
          className="ui-meter"
          data-sev={row.severity}
          data-reset={row.reset ? "" : undefined}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          // The fill stops at 100%; the spoken value is the shown reading,
          // such as "131%" or "reset · was 100%".
          aria-valuetext={text}
          aria-label={row.meterName}
        >
          <span className="ui-meter-track" aria-hidden="true">
            <span
              className="ui-meter-fill"
              style={{ width: `${String(percent)}%` }}
            />
          </span>
          <span className="ui-meter-text" aria-hidden="true">
            {text}
          </span>
        </span>
        <span className="quota-flag">
          {row.severity === "ok" ? null : (
            <StatusGlyph severity={row.severity} />
          )}
        </span>
      </div>
    </td>
  );
}

function QuotaRowCells({
  row,
  now,
}: {
  readonly row: QuotaRow;
  readonly now: Temporal.Instant;
}): React.JSX.Element {
  const resets = resetsText(row, now);
  return (
    <>
      <th
        scope="row"
        role="rowheader"
        className="quota-window"
        title={`${row.windowId} · ${row.windowKind}`}
      >
        <span className="quota-label">{row.label}</span>
        {row.ambiguous ? <code>{row.windowId}</code> : null}
      </th>
      <UsedCell row={row} />
      <td className="quota-resets" role="cell">
        {row.reset || row.resetsAt === undefined ? (
          resets
        ) : (
          <time dateTime={row.resetsAt} title={formatInstant(row.resetsAt)}>
            {resets}
          </time>
        )}
      </td>
    </>
  );
}

/** One provider's windows; the provider names the group from its first row. */
function QuotaGroupBody({
  group,
  now,
}: {
  readonly group: QuotaGroup;
  readonly now: Temporal.Instant;
}): React.JSX.Element {
  return (
    <tbody role="rowgroup">
      {group.rows.map((row, index) => (
        <tr
          key={row.id}
          role="row"
          className="quota-row"
          data-sev={row.severity}
          data-reset={row.reset ? "" : undefined}
        >
          {index === 0 ? (
            <th
              scope="rowgroup"
              role="rowheader"
              rowSpan={group.rows.length}
              className="quota-provider"
              title={group.provider}
            >
              {group.label}
            </th>
          ) : null}
          <QuotaRowCells row={row} now={now} />
        </tr>
      ))}
    </tbody>
  );
}

/**
 * A quota signal the collector sent without the attributes a row needs. It
 * stays in the table, named by its id, so a broken producer is never silent.
 */
function InvalidRows({
  signals,
}: {
  readonly signals: readonly Signal[];
}): React.JSX.Element {
  return (
    <tbody role="rowgroup">
      {signals.map((signal) => (
        <tr key={signal.id} role="row" className="invalid-row">
          <td colSpan={COLUMN_COUNT} role="cell">
            <p role="alert">
              <code>{signal.id}</code> ({signal.title}): the collector sent this
              quota window without its provider, window id, window kind, or
              usage attributes.
            </p>
          </td>
        </tr>
      ))}
    </tbody>
  );
}

/**
 * Every quota window as one compact row, grouped by provider. The explicit
 * ARIA roles repeat the native ones on purpose: the narrow layout changes
 * these elements' `display`, which costs a table its semantics in some
 * browsers.
 */
export function QuotaTable({
  model,
  now,
  labelledBy,
}: {
  readonly model: QuotaTableModel;
  readonly now: Temporal.Instant;
  readonly labelledBy: string;
}): React.JSX.Element {
  return (
    <div className="table-scroll">
      <table
        className="quota-table ui-table"
        role="table"
        aria-labelledby={labelledBy}
      >
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              Provider
            </th>
            <th scope="col" role="columnheader">
              Window
            </th>
            <th scope="col" role="columnheader" className="quota-used-heading">
              Used
            </th>
            <th scope="col" role="columnheader" className="num">
              Resets
            </th>
          </tr>
        </thead>
        {model.invalid.length === 0 ? null : (
          <InvalidRows signals={model.invalid} />
        )}
        {model.groups.map((group) => (
          <QuotaGroupBody key={group.provider} group={group} now={now} />
        ))}
      </table>
    </div>
  );
}

/** The "Subscription quota" panel: the table, or a line when it is empty. */
export function QuotaPanel({
  signals,
  generatedAt,
}: {
  readonly signals: readonly Signal[];
  readonly generatedAt: string;
}): React.JSX.Element {
  const model = quotaTable(signals, generatedAt);
  return (
    <section className="panel quota-panel" aria-labelledby="quota-heading">
      <header className="panel-heading">
        <h2 id="quota-heading">
          Subscription quota <span className="count">{signals.length}</span>
        </h2>
      </header>
      {signals.length === 0 ? (
        <p className="list-empty">No quota windows reported.</p>
      ) : (
        <QuotaTable
          model={model}
          now={Temporal.Now.instant()}
          labelledBy="quota-heading"
        />
      )}
    </section>
  );
}
