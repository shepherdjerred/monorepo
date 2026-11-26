import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";

import { providerLabel } from "./ai-labels.ts";
import { formatValue } from "#shared/ops-format";

/** Attributes the collector attaches to `tool-usage` signals. */
const ToolUsageAttributesSchema = z.object({
  source: z.string().min(1),
  monthToDateUsd: z.number().min(0),
});

export type ToolSpendRow = {
  /** The signal's id. */
  readonly id: string;
  readonly source: string;
  readonly label: string;
  readonly monthToDateUsd: number;
};

export type ToolSpend = {
  /** Highest spend first. */
  readonly rows: readonly ToolSpendRow[];
  readonly totalUsd: number;
  /** Signals whose attributes the collector sent incomplete. */
  readonly invalid: readonly Signal[];
};

/** The tool-usage signals as a ranked table with its total. */
export function toolSpend(signals: readonly Signal[]): ToolSpend {
  const rows: ToolSpendRow[] = [];
  const invalid: Signal[] = [];
  for (const signal of signals) {
    const parsed = ToolUsageAttributesSchema.safeParse(signal.attributes);
    if (parsed.success)
      rows.push({
        id: signal.id,
        source: parsed.data.source,
        label: providerLabel(parsed.data.source),
        monthToDateUsd: parsed.data.monthToDateUsd,
      });
    else invalid.push(signal);
  }
  return {
    rows: rows.toSorted(
      (left, right) =>
        right.monthToDateUsd - left.monthToDateUsd ||
        left.label.localeCompare(right.label, "en"),
    ),
    totalUsd: rows.reduce((sum, row) => sum + row.monthToDateUsd, 0),
    invalid,
  };
}

function ToolSpendTable({
  spend,
}: {
  readonly spend: ToolSpend;
}): React.JSX.Element {
  return (
    <table
      className="tool-table ui-table"
      aria-labelledby="tool-spend-heading"
      aria-describedby="tool-spend-note"
    >
      <thead>
        <tr>
          <th scope="col">Tool</th>
          <th scope="col" className="num">
            API-equivalent this month
          </th>
        </tr>
      </thead>
      <tbody>
        {spend.invalid.map((signal) => (
          <tr key={signal.id} className="invalid-row">
            <td colSpan={2}>
              <p role="alert">
                <code>{signal.id}</code> ({signal.title}): the collector sent
                this tool&apos;s usage without its source or month-to-date
                amount.
              </p>
            </td>
          </tr>
        ))}
        {spend.rows.map((row) => (
          <tr key={row.id}>
            <th scope="row" title={row.source}>
              {row.label}
            </th>
            <td className="num">{formatValue(row.monthToDateUsd, "usd")}</td>
          </tr>
        ))}
      </tbody>
      {spend.rows.length === 0 ? null : (
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="num">{formatValue(spend.totalUsd, "usd")}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/**
 * "Usage by tool": what each coding tool's usage this month would have cost
 * at API prices. It is a comparison of how much each tool is used, not a
 * bill, because most of that usage runs on fixed-price subscriptions.
 */
export function ToolSpendPanel({
  signals,
}: {
  readonly signals: readonly Signal[];
}): React.JSX.Element {
  return (
    <section className="panel tool-panel" aria-labelledby="tool-spend-heading">
      <header className="panel-heading">
        <h2 id="tool-spend-heading">Usage by tool</h2>
      </header>
      {signals.length === 0 ? (
        <p className="list-empty">No tool usage reported.</p>
      ) : (
        <>
          <p className="panel-summary tool-note" id="tool-spend-note">
            API-equivalent is what each tool&apos;s usage on the Mac this month
            would have cost at API prices. Most of it runs on subscriptions, so
            it is not money spent.
          </p>
          <ToolSpendTable spend={toolSpend(signals)} />
        </>
      )}
    </section>
  );
}
