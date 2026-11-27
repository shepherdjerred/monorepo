import { Temporal } from "@js-temporal/polyfill";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { z } from "zod";

import { UplotChart } from "#client/charts/uplot-chart.tsx";
import { providerLabel } from "#client/ops/ai-labels.ts";

import { brimQuery } from "./api.ts";
import {
  BrimPage,
  BrimQueryState,
  BrimSection,
  BrimTable,
  costLabel,
  dateLabel,
  money,
  quantity,
} from "./presentation.tsx";
import {
  BrimOverviewSchema,
  HistoryBlocksSchema,
  UsageBreakdown,
  UsagePeriod,
  UsageReportSchema,
} from "./schema.ts";

type UsageReport = z.infer<typeof UsageReportSchema>;
type Dimension = z.infer<typeof UsageBreakdown>;

function UsageSummary({
  report,
  dimension,
  machines,
}: {
  readonly report: UsageReport;
  readonly dimension: Dimension;
  readonly machines: ReadonlyMap<string, string>;
}) {
  const rows = report.periods.toReversed();
  const points = report.periods.map(
    (row) =>
      [
        Temporal.Instant.from(row.start).epochMilliseconds / 1000,
        row.totalTokens,
      ] as const,
  );
  return (
    <>
      <div className="brim-source">
        <strong>{quantity(report.total.totalTokens)} tokens</strong>
        <span>{costLabel(report.total)} estimated cost</span>
        <span>{quantity(report.total.events)} usage events</span>
        <span>{report.timezone}</span>
      </div>
      {report.total.unpricedModels.length === 0 ? null : (
        <p className="brim-message">
          Cost is a lower bound. Unpriced models include{" "}
          {report.total.unpricedModels.join(", ")}.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="brim-message">No usage in this period.</p>
      ) : (
        <>
          <div className="brim-chart">
            <UplotChart
              label="Indexed tokens by period"
              series={[{ name: "Tokens", points }]}
              unit="tokens"
              mode="bar"
            />
          </div>
          <BrimTable
            label="Usage by period"
            columns={["Period", "Tokens", "Estimated cost", "Events"]}
          >
            {rows.map((period) => (
              <tr key={period.period}>
                <th scope="row">{period.period}</th>
                <td className="ui-num">{quantity(period.totalTokens)}</td>
                <td className="ui-num">{costLabel(period)}</td>
                <td className="ui-num">{quantity(period.events)}</td>
              </tr>
            ))}
          </BrimTable>
          <div className="brim-periods">
            {rows
              .filter((period) => period.breakdown.length > 0)
              .map((period) => (
                <details className="brim-payload" key={period.period}>
                  <summary>
                    {period.period} by {dimension}
                  </summary>
                  <BrimTable
                    label={`${period.period} by ${dimension}`}
                    columns={[
                      providerLabel(dimension),
                      "Tokens",
                      "Estimated cost",
                      "Events",
                    ]}
                  >
                    {period.breakdown.map((row) => {
                      const key = row[dimension];
                      const name =
                        key === null ? "Unknown" : (machines.get(key) ?? key);
                      return (
                        <tr key={key ?? "unknown-breakdown"}>
                          <th scope="row">{name}</th>
                          <td className="ui-num">
                            {quantity(row.totalTokens)}
                          </td>
                          <td className="ui-num">{costLabel(row)}</td>
                          <td className="ui-num">{quantity(row.events)}</td>
                        </tr>
                      );
                    })}
                  </BrimTable>
                </details>
              ))}
          </div>
        </>
      )}
    </>
  );
}

function ActiveBlocks() {
  const query = useQuery(
    brimQuery(
      "history/blocks?machine=all&active=true",
      HistoryBlocksSchema,
      60_000,
    ),
  );
  const data = query.data;
  return (
    <BrimSection title="Active five-hour blocks">
      {data === undefined ? (
        <BrimQueryState label="active blocks" error={query.error} />
      ) : data.blocks.length === 0 ? (
        <p className="brim-message">No active usage blocks.</p>
      ) : (
        <BrimTable
          label="Active usage blocks"
          columns={[
            "Agent",
            "Window",
            "Tokens",
            "Estimated cost",
            "Projection",
          ]}
        >
          {data.blocks.map((block) => (
            <tr key={`${block.agent}-${block.start}`}>
              <th scope="row">{providerLabel(block.agent)}</th>
              <td>
                {dateLabel(block.start)} – {dateLabel(block.end)}
                {block.alignedToQuota ? <small>Quota-aligned</small> : null}
              </td>
              <td className="ui-num">{quantity(block.totalTokens)}</td>
              <td className="ui-num">{costLabel(block)}</td>
              <td className="ui-num">
                {block.projection === null
                  ? "—"
                  : `${quantity(block.projection.projectedTokens)} tokens · ${money(block.projection.projectedCostUsd)}`}
              </td>
            </tr>
          ))}
        </BrimTable>
      )}
    </BrimSection>
  );
}

const timezone = Temporal.Now.timeZoneId();
const ranges = { day: "30d", week: "90d", month: "365d" };

export function BrimUsagePage() {
  const fieldId = useId();
  const [period, setPeriod] = useState<z.infer<typeof UsagePeriod>>("day");
  const [dimension, setDimension] = useState<Dimension>("machine");
  const params = new URLSearchParams({
    period,
    breakdown: dimension,
    timezone,
    since: ranges[period],
  });
  const usage = useQuery(
    brimQuery(`history/usage?${params.toString()}`, UsageReportSchema, 60_000),
  );
  const overview = useQuery(
    brimQuery("overview?includeQuotaHistory=false", BrimOverviewSchema),
  );
  const machines = new Map(
    overview.data?.archive.devices.map((device) => [
      device.machineId,
      device.displayName,
    ]),
  );
  return (
    <BrimPage title="Brim usage">
      <BrimSection
        title="Tokens and estimated cost"
        aside={
          <div className="brim-inline-fields">
            <label htmlFor={`${fieldId}-period`} className="brim-inline-field">
              Group by
              <select
                id={`${fieldId}-period`}
                value={period}
                onChange={(event) => {
                  setPeriod(UsagePeriod.parse(event.currentTarget.value));
                }}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
            <label
              htmlFor={`${fieldId}-dimension`}
              className="brim-inline-field"
            >
              Break down by
              <select
                id={`${fieldId}-dimension`}
                value={dimension}
                onChange={(event) => {
                  setDimension(UsageBreakdown.parse(event.currentTarget.value));
                }}
              >
                {UsageBreakdown.options.map((key) => (
                  <option key={key} value={key}>
                    {providerLabel(key)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      >
        {usage.data === undefined ? (
          <BrimQueryState label="usage" error={usage.error} />
        ) : (
          <UsageSummary
            report={usage.data}
            dimension={dimension}
            machines={machines}
          />
        )}
      </BrimSection>
      <ActiveBlocks />
    </BrimPage>
  );
}
