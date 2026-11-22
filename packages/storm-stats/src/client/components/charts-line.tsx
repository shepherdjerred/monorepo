import { useState } from "react";
import type { DailyActivityPoint } from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  formatCalendarDayLabel,
  formatHours,
  formatInt,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { ResponsiveTable } from "./sortable-table.tsx";

const SVG_WIDTH = 760;
const SVG_HEIGHT = 220;
const PAD_LEFT = 42;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 28;
const PLOT_WIDTH = SVG_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM;

const Y_GRID_RATIOS = [0, 0.5, 1] as const;

function ChartCaption({
  caption,
  firstColor,
  firstLabel,
  secondColor,
  secondLabel,
}: {
  readonly caption: string;
  readonly firstColor: string;
  readonly firstLabel: string;
  readonly secondColor: string;
  readonly secondLabel: string;
}) {
  return (
    <figcaption>
      <span>{caption}</span>
      <span className="chart-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: firstColor }} />
          {firstLabel}
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: secondColor }} />
          {secondLabel}
        </span>
      </span>
    </figcaption>
  );
}

function ChartYAxisGrid({
  formatTick,
}: {
  readonly formatTick: (ratio: number) => string;
}) {
  return (
    <>
      {Y_GRID_RATIOS.map((ratio) => {
        const y = PAD_TOP + PLOT_HEIGHT * (1 - ratio);
        return (
          <g key={ratio}>
            <line
              x1={PAD_LEFT}
              x2={SVG_WIDTH - PAD_RIGHT}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeDasharray={ratio === 0 ? undefined : "3 3"}
            />
            <text
              x={PAD_LEFT - 6}
              y={y + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {formatTick(ratio)}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function DailyPlayersChart({
  points,
  caption,
}: {
  readonly points: readonly DailyActivityPoint[];
  readonly caption: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="panel-subtitle">No daily player history available.</p>;
  }

  const maxPlayers = Math.max(
    1,
    ...points.map((point) =>
      Math.max(point.uniquePlayers, point.returningPlayers + point.newPlayers),
    ),
  );
  const lastPoint = points.at(-1);
  const selected =
    activeIndex === null ? lastPoint : (points[activeIndex] ?? lastPoint);
  const slotWidth = PLOT_WIDTH / points.length;
  const barWidth = Math.max(2, Math.min(18, slotWidth * 0.68));

  return (
    <figure className="chart-figure">
      <ChartCaption
        caption={caption}
        firstColor="var(--accent)"
        firstLabel="Returning"
        secondColor="var(--gold-fg)"
        secondLabel="New Players"
      />

      {selected === undefined ? null : (
        <div className="chart-readout">
          <strong>{formatCalendarDayLabel(selected.day)}</strong>
          <span>
            <strong>{formatInt(selected.uniquePlayers)}</strong> unique (
            {formatInt(selected.returningPlayers)} returning ·{" "}
            {formatInt(selected.newPlayers)} new) ·{" "}
            {formatInt(selected.sessions)} sessions
          </span>
        </div>
      )}

      <div className="chart-svg-wrap">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${String(SVG_WIDTH)} ${String(SVG_HEIGHT)}`}
          className="chart-svg"
        >
          <ChartYAxisGrid
            formatTick={(ratio) => formatInt(Math.round(maxPlayers * ratio))}
          />

          {points.map((point, index) => {
            const x = PAD_LEFT + index * slotWidth + (slotWidth - barWidth) / 2;
            const returningH =
              (point.returningPlayers / maxPlayers) * PLOT_HEIGHT;
            const newH = (point.newPlayers / maxPlayers) * PLOT_HEIGHT;
            const returningY = PAD_TOP + PLOT_HEIGHT - returningH;
            const newY = returningY - newH;
            const showTick =
              index === 0 ||
              index === points.length - 1 ||
              index === Math.floor(points.length / 2);

            return (
              <g
                key={point.day}
                onMouseEnter={() => {
                  setActiveIndex(index);
                }}
              >
                <rect
                  x={PAD_LEFT + index * slotWidth}
                  y={PAD_TOP}
                  width={slotWidth}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                />
                {returningH > 0 ? (
                  <rect
                    x={x}
                    y={returningY}
                    width={barWidth}
                    height={returningH}
                    rx={1.5}
                    fill="var(--accent)"
                  />
                ) : null}
                {newH > 0 ? (
                  <rect
                    x={x}
                    y={newY}
                    width={barWidth}
                    height={newH}
                    rx={1.5}
                    fill="var(--gold-fg)"
                  />
                ) : null}
                {showTick ? (
                  <text
                    x={x + barWidth / 2}
                    y={SVG_HEIGHT - 8}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--text-muted)"
                  >
                    {formatCalendarDayLabel(point.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <DailyTabularSummary points={points} caption={`${caption} (table)`} />
    </figure>
  );
}

export function DailyPlaytimeChart({
  points,
  caption,
}: {
  readonly points: readonly DailyActivityPoint[];
  readonly caption: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <p className="panel-subtitle">No daily playtime history available.</p>
    );
  }

  const maxHours = Math.max(
    1,
    ...points.map((point) => Math.max(point.connectedHours, point.activeHours)),
  );
  const lastPoint = points.at(-1);
  const selected =
    activeIndex === null ? lastPoint : (points[activeIndex] ?? lastPoint);
  const stepX =
    points.length > 1 ? PLOT_WIDTH / (points.length - 1) : PLOT_WIDTH;

  const connectedCoords = points.map((point, index) => {
    const x = PAD_LEFT + index * stepX;
    const y = PAD_TOP + PLOT_HEIGHT * (1 - point.connectedHours / maxHours);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const activeCoords = points.map((point, index) => {
    const x = PAD_LEFT + index * stepX;
    const y = PAD_TOP + PLOT_HEIGHT * (1 - point.activeHours / maxHours);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const baselineY = (PAD_TOP + PLOT_HEIGHT).toFixed(1);
  const lastX = (PAD_LEFT + (points.length - 1) * stepX).toFixed(1);
  const connectedArea = `${String(PAD_LEFT)},${baselineY} ${connectedCoords.join(" ")} ${lastX},${baselineY}`;
  const activeArea = `${String(PAD_LEFT)},${baselineY} ${activeCoords.join(" ")} ${lastX},${baselineY}`;

  return (
    <figure className="chart-figure">
      <ChartCaption
        caption={caption}
        firstColor="var(--cyan)"
        firstLabel="Connected Hours"
        secondColor="var(--accent)"
        secondLabel="Active Hours"
      />

      {selected === undefined ? null : (
        <div className="chart-readout">
          <strong>{formatCalendarDayLabel(selected.day)}</strong>
          <span>
            <strong>{formatHours(selected.activeHours)}</strong> active /{" "}
            <strong>{formatHours(selected.connectedHours)}</strong> connected
          </span>
        </div>
      )}

      <div className="chart-svg-wrap">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${String(SVG_WIDTH)} ${String(SVG_HEIGHT)}`}
          className="chart-svg"
        >
          <ChartYAxisGrid
            formatTick={(ratio) => formatHours(maxHours * ratio)}
          />

          <polygon points={connectedArea} fill="var(--cyan)" opacity="0.18" />
          <polyline
            points={connectedCoords.join(" ")}
            fill="none"
            stroke="var(--cyan)"
            strokeWidth="2"
          />
          <polygon points={activeArea} fill="var(--accent)" opacity="0.28" />
          <polyline
            points={activeCoords.join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.4"
          />

          {points.map((point, index) => {
            const slotW = PLOT_WIDTH / points.length;
            return (
              <rect
                key={point.day}
                x={PAD_LEFT + index * slotW}
                y={PAD_TOP}
                width={slotW}
                height={PLOT_HEIGHT}
                fill="transparent"
                onMouseEnter={() => {
                  setActiveIndex(index);
                }}
              />
            );
          })}
        </svg>
      </div>

      <DailyTabularSummary points={points} caption={`${caption} (table)`} />
    </figure>
  );
}

function DailyTabularSummary({
  points,
  caption,
}: {
  readonly points: readonly DailyActivityPoint[];
  readonly caption: string;
}) {
  const recentSlice = points.slice(-14).reverse();
  return (
    <details className="session-disclosure">
      <summary>
        <span className="panel-subtitle">
          View daily tabular figures (latest {formatInt(recentSlice.length)} of{" "}
          {formatInt(points.length)} days)
        </span>
      </summary>
      <div style={{ padding: "0.65rem" }}>
        <ResponsiveTable caption={caption} compact>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="num-col">
                Unique
              </th>
              <th scope="col" className="num-col">
                New
              </th>
              <th scope="col" className="num-col">
                Active
              </th>
              <th scope="col" className="num-col">
                Connected
              </th>
              <th scope="col" className="num-col">
                Sessions
              </th>
            </tr>
          </thead>
          <tbody>
            {recentSlice.map((row) => (
              <tr key={row.day}>
                <th scope="row">{row.day}</th>
                <td data-label="Unique" className="num-col">
                  {formatInt(row.uniquePlayers)}
                </td>
                <td data-label="New" className="num-col">
                  {formatInt(row.newPlayers)}
                </td>
                <td data-label="Active" className="num-col">
                  {formatHours(row.activeHours)}
                </td>
                <td data-label="Connected" className="num-col">
                  {formatHours(row.connectedHours)}
                </td>
                <td data-label="Sessions" className="num-col">
                  {formatInt(row.sessions)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
    </details>
  );
}
