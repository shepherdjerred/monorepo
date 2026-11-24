import { useState } from "react";
import type {
  PlayerbaseBreakdown,
  PunchcardCell,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  formatCalendarDayLabel,
  formatHours,
  formatInt,
  formatPercent,
} from "@shepherdjerred/storm-stats/client/format.ts";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function formatHourSlot(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function PacificPunchcard({
  cells,
}: {
  readonly cells: readonly PunchcardCell[];
}) {
  const [hovered, setHovered] = useState<PunchcardCell | null>(null);

  const cellMap = new Map<string, PunchcardCell>();
  let maxActive = 0.25;
  let peakCell: PunchcardCell | undefined;
  for (const cell of cells) {
    cellMap.set(`${String(cell.dayOfWeek)}-${String(cell.hour)}`, cell);
    if (cell.activeHours > maxActive) {
      maxActive = cell.activeHours;
    }
    if (peakCell === undefined || cell.activeHours > peakCell.activeHours) {
      peakCell = cell;
    }
  }

  const readout = hovered ?? peakCell;

  return (
    <figure className="chart-figure">
      <figcaption>
        <span>
          24×7 Community Punchcard (<code>America/Los_Angeles</code>)
        </span>
        {peakCell === undefined ? null : (
          <span>
            Peak window:{" "}
            <strong>
              {DAY_NAMES[peakCell.dayOfWeek] ?? "Mon"}{" "}
              {formatHourSlot(peakCell.hour)} PT
            </strong>{" "}
            ({formatHours(peakCell.activeHours)} active)
          </span>
        )}
      </figcaption>

      {readout === undefined ? null : (
        <div className="chart-readout">
          <strong>
            {DAY_NAMES[readout.dayOfWeek] ?? "Mon"} ·{" "}
            {formatHourSlot(readout.hour)} PT
          </strong>
          <span>
            <strong>{formatHours(readout.activeHours)}</strong> active ·{" "}
            <strong>{formatInt(readout.uniquePlayers)}</strong> unique players ·{" "}
            {formatInt(readout.sessions)} sessions
          </span>
        </div>
      )}

      <div className="chart-svg-wrap">
        <svg
          aria-hidden="true"
          viewBox="0 0 760 236"
          className="chart-svg"
          style={{ minInlineSize: "34rem" }}
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <text
              key={hour}
              x={56 + hour * 29}
              y={18}
              textAnchor="middle"
              fontSize="10"
              fill="var(--text-muted)"
            >
              {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
            </text>
          ))}

          {DAY_NAMES.map((dayLabel, dayIdx) => {
            const rowY = 38 + dayIdx * 28;
            return (
              <g key={dayLabel}>
                <text
                  x={40}
                  y={rowY + 4}
                  textAnchor="end"
                  fontSize="11"
                  fontWeight="600"
                  fill="var(--text-secondary)"
                >
                  {dayLabel}
                </text>
                {Array.from({ length: 24 }, (_, hour) => {
                  const cx = 56 + hour * 29;
                  const cell = cellMap.get(
                    `${String(dayIdx)}-${String(hour)}`,
                  ) ?? {
                    dayOfWeek: dayIdx,
                    hour,
                    activeHours: 0,
                    uniquePlayers: 0,
                    sessions: 0,
                  };
                  const intensity = Math.min(1, cell.activeHours / maxActive);
                  const radius =
                    cell.activeHours <= 0
                      ? 2.5
                      : 3.5 + Math.sqrt(intensity) * 8.5;
                  return (
                    <g
                      key={hour}
                      onMouseEnter={() => {
                        setHovered(cell);
                      }}
                    >
                      <rect
                        x={cx - 14}
                        y={rowY - 13}
                        width={28}
                        height={26}
                        fill="transparent"
                      />
                      <circle
                        cx={cx}
                        cy={rowY}
                        r={radius}
                        fill={
                          cell.activeHours <= 0
                            ? "var(--border)"
                            : "var(--accent)"
                        }
                        opacity={
                          cell.activeHours <= 0 ? 0.55 : 0.25 + intensity * 0.75
                        }
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

export type CalendarHeatmapPoint = {
  readonly day: string;
  readonly activeHours: number;
  readonly connectedHours: number;
  readonly sessions: number;
};

function heatFillForRatio(ratio: number): {
  readonly fill: string;
  readonly opacity: number;
} {
  if (ratio <= 0) {
    return { fill: "var(--bg-subtle)", opacity: 1 };
  }
  if (ratio < 0.25) {
    return { fill: "var(--accent)", opacity: 0.3 };
  }
  if (ratio < 0.5) {
    return { fill: "var(--accent)", opacity: 0.52 };
  }
  return ratio < 0.8
    ? { fill: "var(--accent)", opacity: 0.76 }
    : { fill: "var(--accent)", opacity: 1 };
}

export function ActivityCalendarHeatmap({
  days,
  caption,
  maxDays = 365,
}: {
  readonly days: readonly CalendarHeatmapPoint[];
  readonly caption: string;
  readonly maxDays?: number;
}) {
  const sliced = days.slice(-maxDays);
  const [selected, setSelected] = useState<CalendarHeatmapPoint | null>(null);

  if (sliced.length === 0) {
    return <p className="panel-subtitle">No calendar activity recorded yet.</p>;
  }

  const maxActive = Math.max(0.5, ...sliced.map((day) => day.activeHours));
  const activeDaysCount = sliced.filter((day) => day.activeHours > 0).length;
  const totalActive = sliced.reduce((sum, day) => sum + day.activeHours, 0);
  const readout = selected ?? sliced.at(-1);
  const weeksCount = Math.ceil(sliced.length / 7);
  const cellSize = 11;
  const cellGap = 3;
  const step = cellSize + cellGap;
  const svgWidth = Math.max(320, 28 + weeksCount * step);

  return (
    <figure className="chart-figure">
      <figcaption>
        <span>{caption}</span>
        <span>
          <strong>{formatInt(activeDaysCount)}</strong> active days ·{" "}
          <strong>{formatHours(totalActive)}</strong> active playtime
        </span>
      </figcaption>

      {readout === undefined ? null : (
        <div className="chart-readout">
          <strong>
            {readout.day} ({formatCalendarDayLabel(readout.day)})
          </strong>
          <span>
            <strong>{formatHours(readout.activeHours)}</strong> active /{" "}
            {formatHours(readout.connectedHours)} connected ·{" "}
            {formatInt(readout.sessions)} sessions
          </span>
        </div>
      )}

      <div className="chart-svg-wrap">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${String(svgWidth)} 114`}
          className="chart-svg"
          style={{ minInlineSize: "34rem" }}
        >
          {sliced.map((point, index) => {
            const col = Math.floor(index / 7);
            const row = index % 7;
            const x = 22 + col * step;
            const y = 14 + row * step;
            const style = heatFillForRatio(point.activeHours / maxActive);
            return (
              <rect
                key={point.day}
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={style.fill}
                opacity={style.opacity}
                stroke="var(--border)"
                strokeWidth="0.6"
                onMouseEnter={() => {
                  setSelected(point);
                }}
              />
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

export function PlayerbaseHealthCard({
  groups,
}: {
  readonly groups: PlayerbaseBreakdown;
}) {
  const denom = Math.max(1, groups.total);
  const segments = [
    {
      key: "regular",
      label: "Regular",
      count: groups.regular,
      pct: (groups.regular / denom) * 100,
      color: "var(--group-regular-fg)",
      pillClass: "pill pill-regular",
    },
    {
      key: "active",
      label: "Active",
      count: groups.active,
      pct: (groups.active / denom) * 100,
      color: "var(--group-active-fg)",
      pillClass: "pill pill-active",
    },
    {
      key: "irregular",
      label: "Irregular",
      count: groups.irregular,
      pct: (groups.irregular / denom) * 100,
      color: "var(--group-irregular-fg)",
      pillClass: "pill pill-irregular",
    },
    {
      key: "inactive",
      label: "Inactive",
      count: groups.inactive,
      pct: (groups.inactive / denom) * 100,
      color: "var(--group-inactive-fg)",
      pillClass: "pill pill-inactive",
    },
  ] as const;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Playerbase Health (Activity Index)</h2>
        <span className="panel-subtitle">
          {formatInt(groups.total)} tracked players
        </span>
      </div>

      <div className="stacked-bar" aria-hidden="true">
        {segments.map((segment) =>
          segment.count > 0 ? (
            <div
              key={segment.key}
              style={{
                inlineSize: `${segment.pct.toFixed(2)}%`,
                background: segment.color,
              }}
            />
          ) : null,
        )}
      </div>

      <div className="share-list" style={{ marginBlockStart: "0.95rem" }}>
        {segments.map((segment) => (
          <div key={segment.key} className="share-row-head">
            <span className={segment.pillClass}>{segment.label}</span>
            <span>
              <strong>{formatInt(segment.count)}</strong> players (
              {formatPercent(segment.pct, 1)})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type ShareBarEntry = {
  readonly key: string;
  readonly label: string;
  readonly sharePercent: number;
  readonly detail: string;
};

export function ShareBreakdownPanel({
  title,
  subtitle,
  items,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly items: readonly ShareBarEntry[];
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <span className="panel-subtitle">{subtitle}</span>
      </div>
      {items.length === 0 ? (
        <p className="panel-subtitle">No breakdown data available yet.</p>
      ) : (
        <div className="share-list">
          {items.map((item) => (
            <div key={item.key} className="share-row">
              <div className="share-row-head">
                <strong>{item.label}</strong>
                <span>
                  {item.detail} ·{" "}
                  <strong>{formatPercent(item.sharePercent, 1)}</strong>
                </span>
              </div>
              <div className="share-track" aria-hidden="true">
                <div
                  className="share-fill"
                  style={{
                    inlineSize: `${Math.min(100, Math.max(0, item.sharePercent)).toFixed(1)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
